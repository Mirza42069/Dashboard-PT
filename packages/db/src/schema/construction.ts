import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { company } from "./company";

/**
 * Construction management domain.
 *
 * Conventions match ./auth.ts: text primary keys (so foreign keys into `user`
 * line up), explicit snake_case column names, and createdAt/updatedAt with
 * .defaultNow().$onUpdate().
 *
 * Two deliberate choices worth knowing before you change anything here:
 *
 * 1. Schedule fields are `date`, not `timestamp`. There is no superjson
 *    transformer on the tRPC client, so a Date would arrive at the browser as a
 *    string anyway. Storing plain calendar dates keeps them as "YYYY-MM-DD" the
 *    whole way through and removes any chance of a timezone shifting a
 *    site's start date by a day.
 *
 * 2. Money is numeric(14,2). Drizzle hands these back as *strings* to avoid
 *    float rounding; convert once at the API boundary via
 *    packages/api/src/lib/money.ts, never ad hoc in a component.
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export const BOQ_VERSION_STATUSES = ["draft", "active", "superseded"] as const;
export const SCHEDULE_VERSION_STATUSES = ["draft", "active"] as const;
/** "derived" weights are recomputed from value; "manual" ones are left alone. */
export const WEIGHT_SOURCES = ["derived", "manual"] as const;
export const DISTRIBUTION_TYPES = ["linear", "manual"] as const;
export const PROGRESS_MODES = ["by_quantity", "by_percent"] as const;
export const PERIOD_TYPES = ["weekly", "biweekly", "monthly"] as const;
export const PERIOD_STATUSES = ["open", "locked"] as const;
/**
 * An import either lands whole or not at all, so there is no "pending" — the
 * row is written once the outcome is known. Failed attempts are recorded too:
 * the error report has to survive the request that produced it, or "download
 * the failed rows" has nothing to read.
 */
export const BOQ_IMPORT_STATUSES = ["succeeded", "failed"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type BoqVersionStatus = (typeof BOQ_VERSION_STATUSES)[number];
export type ScheduleVersionStatus = (typeof SCHEDULE_VERSION_STATUSES)[number];
export type WeightSource = (typeof WEIGHT_SOURCES)[number];
export type DistributionType = (typeof DISTRIBUTION_TYPES)[number];
export type ProgressMode = (typeof PROGRESS_MODES)[number];
export type PeriodType = (typeof PERIOD_TYPES)[number];
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];
export type BoqImportStatus = (typeof BOQ_IMPORT_STATUSES)[number];

const companyId = () =>
  text("company_id")
    .notNull()
    // restrict, not cascade: deleting a company must never silently take a
    // portfolio of projects with it.
    .references(() => company.id, { onDelete: "restrict" });

export const project = pgTable(
  "project",
  {
    id: id(),
    companyId: companyId(),
    // Unique per company, not globally — two tenants may both run a "PRJ-001".
    code: text("code").notNull(),
    name: text("name").notNull(),
    client: text("client"),
    location: text("location"),
    status: text("status").$type<ProjectStatus>().default("planning").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    /**
      * Site progress 0-100, entered by the PM rather than derived from tickets.
     * Used only as the fallback for projects with no active BoQ baseline — once
     * one exists the API reports progress derived from the BoQ instead.
     */
    progress: integer("progress").default(0).notNull(),
    /** Cadence the reporting periods are generated at. */
    periodType: text("period_type").$type<PeriodType>().default("weekly").notNull(),
    /** Optional override when reporting starts later than the contract does. */
    scheduleStart: date("schedule_start"),
    /**
     * The as-of date every progress figure is measured against: the end of the
     * latest period that actually holds a reading. Derived — rewritten by the
     * same batch that saves progress, never edited by hand.
     */
    dataDate: date("data_date"),
    managerId: text("manager_id").references(() => user.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("project_status_idx").on(table.status),
    index("project_managerId_idx").on(table.managerId),
    index("project_companyId_idx").on(table.companyId),
    unique("project_companyId_code_key").on(table.companyId, table.code),
  ],
);

/**
 * Which `user` (role=user) accounts may see and act on a given project. A
 * project is scoped by company alone; this row-level layer is what limits a
 * company's Users to the subset of projects an admin has assigned them to.
 */
export const projectMember = pgTable(
  "project_member",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: "project_member_pk", columns: [table.projectId, table.userId] }),
    // Hot path: "all projects visible to user X" (project list/get membership filter).
    index("projectMember_userId_idx").on(table.userId),
  ],
);

export const ticket = pgTable(
  "ticket",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    issuerId: text("issuer_id").references(() => user.id, { onDelete: "set null" }),
    /** Snapshot retained if the issuer account is later removed. */
    issuerName: text("issuer_name").notNull(),
    responsibleName: text("responsible_name").notNull(),
    responsibleContactNumber: text("responsible_contact_number").notNull(),
    status: text("status").$type<TicketStatus>().default("open").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("ticket_projectId_idx").on(table.projectId),
    index("ticket_issuerId_idx").on(table.issuerId),
    index("ticket_status_idx").on(table.status),
  ],
);

/**
 * Bill of Quantities.
 *
 * Five tables model one idea: what was contracted, when it was meant to happen,
 * and what actually happened — so that "we are 6% behind" is a computed fact
 * rather than someone's estimate.
 *
 *   boqVersion            one baseline per project
 *   boqItem               the priced work breakdown (sections and their leaves)
 *   reportingPeriod       the time axis (weekly / biweekly / monthly buckets)
 *   boqItemDistribution   PLANNED — what share of each item falls in each period
 *   progressEntry         ACTUAL  — cumulative completion recorded per period
 *
 * Deviation = actual % − planned %, both weighted by the same item weights and
 * both measured at the project's data date. Nothing about that number is
 * stored — it is derived on read.
 */
export const boqVersion = pgTable(
  "boq_version",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    sourceVersionId: text("source_version_id").references((): AnyPgColumn => boqVersion.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: text("status").$type<BoqVersionStatus>().default("draft").notNull(),
    scheduleStatus: text("schedule_status")
      .$type<ScheduleVersionStatus>()
      .default("draft")
      .notNull(),
    /** Sum of leaf values, cached at recalc time for display only. */
    totalValue: numeric("total_value", { precision: 20, scale: 2 }),
    baselinedAt: timestamp("baselined_at"),
    baselinedById: text("baselined_by_id").references(() => user.id, { onDelete: "set null" }),
    scheduleBaselinedAt: timestamp("schedule_baselined_at"),
    scheduleBaselinedById: text("schedule_baselined_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("boqVersion_projectId_idx").on(table.projectId),
    uniqueIndex("boqVersion_project_versionNo_idx").on(table.projectId, table.versionNo),
    // A project has at most one baseline in force. Enforced here rather than in
    // application code because activation cannot run inside a transaction.
    uniqueIndex("boqVersion_oneActive_idx")
      .on(table.projectId)
      .where(sql`status = 'active'`),
    uniqueIndex("boqVersion_oneDraft_idx")
      .on(table.projectId)
      .where(sql`status = 'draft'`),
  ],
);

/**
 * One row per line of the BoQ. `parentId` null means a section header; anything
 * with no live children is a *leaf*, and leaves are what carry weight, planned
 * distribution and progress. A section with no children prices itself, so a
 * flat BoQ works without ceremony.
 *
 * `value` is a stored generated column, not something the API writes. That is
 * what lets the weight recalculation below be a single UPDATE — the alternative
 * (read values, compute in JS, write back) is two statements the Neon HTTP
 * driver cannot make atomic.
 */
export const boqItem = pgTable(
  "boq_item",
  {
    id: id(),
    boqVersionId: text("boq_version_id")
      .notNull()
      .references(() => boqVersion.id, { onDelete: "cascade" }),
    /** Stable identity copied into revisions so schedule and progress can be carried forward. */
    lineageId: text("lineage_id")
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    parentId: text("parent_id").references((): AnyPgColumn => boqItem.id, { onDelete: "cascade" }),
    /** WBS code, unique among its siblings: "1", "2.1", "A.3". */
    code: text("code").notNull(),
    description: text("description").notNull(),
    unit: text("unit"),
    quantity: numeric("quantity", { precision: 20, scale: 4 }),
    unitRate: numeric("unit_rate", { precision: 20, scale: 4 }),
    value: numeric("value", { precision: 20, scale: 2 }).generatedAlwaysAs(
      sql`quantity * unit_rate`,
    ),
    /** "Bobot" — this leaf's share of the contract, in percent. */
    weight: numeric("weight", { precision: 9, scale: 6 }).default("0").notNull(),
    weightSource: text("weight_source").$type<WeightSource>().default("derived").notNull(),
    distribution: text("distribution").$type<DistributionType>().default("linear").notNull(),
    progressMode: text("progress_mode").$type<ProgressMode>().default("by_quantity").notNull(),
    /**
     * The planning window — "MINGGU 3 → MINGGU 17" on a contractor's schedule.
     *
     * Stored as `reporting_period.period_index`, not a foreign key: items are
     * deep-copied into every new revision (see boq.getOrCreateDraft) and an
     * index copies across as a plain column, where an id would have to be
     * remapped. Periods belong to the project rather than the revision, so the
     * index means the same thing in both.
     *
     * Duration and the per-period share are *derived* from this pair and never
     * stored. What is stored is the intent, which is why this is not simply
     * inferred from the first and last non-zero distribution cell: a line
     * planned across weeks 3-17 with a hand-zeroed week 9 would otherwise be
     * indistinguishable from one planned 3-8 and 10-17, and clearing the row
     * would erase the window along with the cells.
     */
    plannedStartPeriodIndex: integer("planned_start_period_index"),
    plannedFinishPeriodIndex: integer("planned_finish_period_index"),
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Soft delete: a removed line still has progress history pointing at it. */
    deletedAt: timestamp("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("boqItem_boqVersionId_idx").on(table.boqVersionId),
    index("boqItem_lineageId_idx").on(table.lineageId),
    index("boqItem_parentId_idx").on(table.parentId),
    // coalesce() rather than NULLS NOT DISTINCT: section codes (parentId null)
    // must collide with each other too, and this form works on any Postgres.
    uniqueIndex("boqItem_version_parent_code_idx")
      .on(table.boqVersionId, sql`coalesce(parent_id, '')`, table.code)
      .where(sql`deleted_at is null`),
  ],
);

/** The time axis progress is reported against. Generated from contract dates. */
export const reportingPeriod = pgTable(
  "reporting_period",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    periodIndex: integer("period_index").notNull(),
    /** "W3" / "P2" / "M5", by cadence. */
    label: text("label"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").$type<PeriodStatus>().default("open").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("reportingPeriod_project_index_idx").on(table.projectId, table.periodIndex),
    index("reportingPeriod_project_endDate_idx").on(table.projectId, table.endDate),
  ],
);

/**
 * PLANNED. `plannedPct` is the share **of this item** scheduled in this period,
 * so a row across all periods should total 100. A cell at zero is deleted
 * rather than stored — absent and zero mean the same thing for planning.
 */
export const boqItemDistribution = pgTable(
  "boq_item_distribution",
  {
    id: id(),
    boqItemId: text("boq_item_id")
      .notNull()
      .references(() => boqItem.id, { onDelete: "cascade" }),
    periodId: text("period_id")
      .notNull()
      .references(() => reportingPeriod.id, { onDelete: "cascade" }),
    plannedPct: numeric("planned_pct", { precision: 9, scale: 6 }).notNull(),
  },
  (table) => [
    uniqueIndex("boqItemDistribution_item_period_idx").on(table.boqItemId, table.periodId),
    index("boqItemDistribution_periodId_idx").on(table.periodId),
  ],
);

/**
 * ACTUAL. Readings are **cumulative to date**, not per-period deltas — that is
 * how site engineers report ("we're at 40% of the piling now"), and it means a
 * missed period is a gap to carry forward rather than a lost increment.
 *
 * A row whose cumulative columns are both null is a *cleared* cell: someone
 * wiped a mistaken entry. It is not a reading of zero, and the distinction
 * matters — zero resets the curve, cleared carries the previous value forward.
 */
export const progressEntry = pgTable(
  "progress_entry",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    periodId: text("period_id")
      .notNull()
      .references(() => reportingPeriod.id, { onDelete: "cascade" }),
    boqItemId: text("boq_item_id")
      .notNull()
      .references(() => boqItem.id, { onDelete: "cascade" }),
    /** Used when the item is measured by_quantity. */
    cumulativeQuantity: numeric("cumulative_quantity", { precision: 20, scale: 4 }),
    /** Used when the item is measured by_percent. */
    cumulativePercent: numeric("cumulative_percent", { precision: 9, scale: 4 }),
    /** Whichever of the two above applies, resolved to 0-100 at write time. */
    pctComplete: numeric("pct_complete", { precision: 9, scale: 4 }).default("0").notNull(),
    note: text("note"),
    recordedById: text("recorded_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("progressEntry_period_item_idx").on(table.periodId, table.boqItemId),
    index("progressEntry_projectId_idx").on(table.projectId),
    index("progressEntry_boqItemId_idx").on(table.boqItemId),
  ],
);

/**
 * One attempt at building a BoQ from a spreadsheet.
 *
 * Written once, at the end of the attempt, and never updated. A successful
 * import names the draft revision it produced; a failed one names none, because
 * a failed import writes no items at all — the validation runs to completion
 * first and a single bad row stops the whole commit. That is the difference
 * between this and a job queue: there is no half-imported state to model.
 *
 * `errors` holds the rejected rows as JSON so the error report can be
 * downloaded after the request that produced it has gone. `mapping` records
 * which spreadsheet column was read as which field, which is the first thing
 * anyone asks when an import produced the wrong numbers.
 */
export const boqImport = pgTable(
  "boq_import",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    /** Null on a failed attempt, and if the draft it created is later discarded. */
    boqVersionId: text("boq_version_id").references(() => boqVersion.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    sheetName: text("sheet_name").notNull(),
    importedById: text("imported_by_id").references(() => user.id, { onDelete: "set null" }),
    /** Snapshot retained if the account is later removed — same rule as activityLog. */
    importedByName: text("imported_by_name").notNull(),
    status: text("status").$type<BoqImportStatus>().notNull(),
    rowsTotal: integer("rows_total").default(0).notNull(),
    rowsImported: integer("rows_imported").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    /** JSON: { field: columnHeader }. */
    mapping: text("mapping"),
    /** JSON: { row, column, message }[]. */
    errors: text("errors"),
    createdAt: createdAt(),
  },
  (table) => [
    index("boqImport_projectId_idx").on(table.projectId),
    index("boqImport_createdAt_idx").on(table.createdAt),
  ],
);

/** Site diary entries. Each can carry photos as evidence — see notePhoto. */
export const projectNote = pgTable(
  "project_note",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("projectNote_projectId_idx").on(table.projectId)],
);

/**
 * Binary column for image bytes.
 *
 * Going out, the value has to be a `\x`-prefixed hex string: the neon-http
 * driver serialises parameters as JSON, which cannot carry a raw Buffer.
 * Coming back, pg-types has already decoded the column into a Buffer, so
 * fromDriver only needs to pass it through — re-parsing it as hex would eat
 * the first two bytes of every image.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer | string }>({
  dataType: () => "bytea",
  toDriver: (value) => `\\x${value.toString("hex")}`,
  fromDriver: (value) =>
    Buffer.isBuffer(value) ? value : Buffer.from(value.replace(/^\\x/, ""), "hex"),
});

export const notePhoto = pgTable(
  "note_photo",
  {
    id: id(),
    noteId: text("note_id")
      .notNull()
      .references(() => projectNote.id, { onDelete: "cascade" }),
    /** The image itself, compressed in the browser before upload. */
    data: bytea("data").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size"),
    createdAt: createdAt(),
  },
  (table) => [index("notePhoto_noteId_idx").on(table.noteId)],
);

export const ACTIVITY_ENTITIES = [
  "project",
  "ticket",
  "note",
  "user",
  "boq",
  "period",
  "progress",
] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

export const ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "assigned",
  "status_changed",
  "paused",
  "resumed",
  "role_changed",
  "baselined",
  "generated",
  "progress_recorded",
  "imported",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * Audit trail. Deliberately denormalised and holding **no foreign key to the
 * entity**: "who deleted PRJ-001" has to outlive PRJ-001, and a cascade would
 * erase exactly the row you came looking for. `entityLabel` and `actorName` are
 * copied in at write time for the same reason — a deleted user must still be
 * named in the history they made.
 *
 * `action` stores a stable key, never a sentence, so the feed renders in
 * whichever language the viewer picked and old rows follow wording changes.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    /** Nullable: rows written before companies existed have no tenant. */
    companyId: text("company_id").references(() => company.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: text("action").$type<ActivityAction>().notNull(),
    entityType: text("entity_type").$type<ActivityEntity>().notNull(),
    entityId: text("entity_id").notNull(),
    entityLabel: text("entity_label").notNull(),
    /** Optional extra, e.g. the new status on a status_changed row. */
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (table) => [
    index("activityLog_createdAt_idx").on(table.createdAt),
    index("activityLog_entityId_idx").on(table.entityId),
    index("activityLog_companyId_idx").on(table.companyId),
  ],
);

export const companyRelations = relations(company, ({ many }) => ({
  projects: many(project),
  users: many(user),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  company: one(company, { fields: [project.companyId], references: [company.id] }),
  manager: one(user, { fields: [project.managerId], references: [user.id] }),
  tickets: many(ticket),
  notes: many(projectNote),
  boqVersions: many(boqVersion),
  reportingPeriods: many(reportingPeriod),
  progressEntries: many(progressEntry),
  members: many(projectMember),
  boqImports: many(boqImport),
}));

export const boqImportRelations = relations(boqImport, ({ one }) => ({
  project: one(project, { fields: [boqImport.projectId], references: [project.id] }),
  version: one(boqVersion, { fields: [boqImport.boqVersionId], references: [boqVersion.id] }),
  importedBy: one(user, { fields: [boqImport.importedById], references: [user.id] }),
}));

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(project, { fields: [projectMember.projectId], references: [project.id] }),
  user: one(user, { fields: [projectMember.userId], references: [user.id] }),
}));

export const boqVersionRelations = relations(boqVersion, ({ one, many }) => ({
  project: one(project, { fields: [boqVersion.projectId], references: [project.id] }),
  baselinedBy: one(user, { fields: [boqVersion.baselinedById], references: [user.id] }),
  items: many(boqItem),
}));

export const boqItemRelations = relations(boqItem, ({ one, many }) => ({
  version: one(boqVersion, { fields: [boqItem.boqVersionId], references: [boqVersion.id] }),
  parent: one(boqItem, {
    relationName: "boqItemTree",
    fields: [boqItem.parentId],
    references: [boqItem.id],
  }),
  children: many(boqItem, { relationName: "boqItemTree" }),
  distribution: many(boqItemDistribution),
  progressEntries: many(progressEntry),
}));

export const reportingPeriodRelations = relations(reportingPeriod, ({ one, many }) => ({
  project: one(project, { fields: [reportingPeriod.projectId], references: [project.id] }),
  distribution: many(boqItemDistribution),
  progressEntries: many(progressEntry),
}));

export const boqItemDistributionRelations = relations(boqItemDistribution, ({ one }) => ({
  item: one(boqItem, { fields: [boqItemDistribution.boqItemId], references: [boqItem.id] }),
  period: one(reportingPeriod, {
    fields: [boqItemDistribution.periodId],
    references: [reportingPeriod.id],
  }),
}));

export const progressEntryRelations = relations(progressEntry, ({ one }) => ({
  project: one(project, { fields: [progressEntry.projectId], references: [project.id] }),
  item: one(boqItem, { fields: [progressEntry.boqItemId], references: [boqItem.id] }),
  period: one(reportingPeriod, {
    fields: [progressEntry.periodId],
    references: [reportingPeriod.id],
  }),
  recordedBy: one(user, { fields: [progressEntry.recordedById], references: [user.id] }),
}));

export const projectNoteRelations = relations(projectNote, ({ one, many }) => ({
  project: one(project, { fields: [projectNote.projectId], references: [project.id] }),
  author: one(user, { fields: [projectNote.authorId], references: [user.id] }),
  photos: many(notePhoto),
}));

export const notePhotoRelations = relations(notePhoto, ({ one }) => ({
  note: one(projectNote, { fields: [notePhoto.noteId], references: [projectNote.id] }),
}));

export const ticketRelations = relations(ticket, ({ one }) => ({
  project: one(project, { fields: [ticket.projectId], references: [project.id] }),
  issuer: one(user, { fields: [ticket.issuerId], references: [user.id] }),
}));
