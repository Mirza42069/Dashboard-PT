import { relations, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

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
export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high"] as const;
export const MOVEMENT_TYPES = ["in", "out", "adjustment"] as const;
export const EQUIPMENT_STATUSES = ["available", "in_use", "maintenance", "retired"] as const;
export const EXPENSE_CATEGORIES = [
  "labor",
  "materials",
  "equipment",
  "subcontractor",
  "other",
] as const;

/**
 * Only draft and active exist today. The version number and the
 * one-active-per-project index are already in place, so adding "superseded" for
 * a revise-and-supersede flow later is a widening of this array, not a
 * migration.
 */
export const BOQ_VERSION_STATUSES = ["draft", "active"] as const;
/** "derived" weights are recomputed from value; "manual" ones are left alone. */
export const WEIGHT_SOURCES = ["derived", "manual"] as const;
export const DISTRIBUTION_TYPES = ["linear", "manual"] as const;
export const PROGRESS_MODES = ["by_quantity", "by_percent"] as const;
export const PERIOD_TYPES = ["weekly", "biweekly", "monthly"] as const;
export const PERIOD_STATUSES = ["open", "locked"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type BoqVersionStatus = (typeof BOQ_VERSION_STATUSES)[number];
export type WeightSource = (typeof WEIGHT_SOURCES)[number];
export type DistributionType = (typeof DISTRIBUTION_TYPES)[number];
export type ProgressMode = (typeof PROGRESS_MODES)[number];
export type PeriodType = (typeof PERIOD_TYPES)[number];
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const project = pgTable(
  "project",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    client: text("client"),
    location: text("location"),
    status: text("status").$type<ProjectStatus>().default("planning").notNull(),
    startDate: date("start_date"),
    endDate: date("end_date"),
    contractValue: numeric("contract_value", { precision: 14, scale: 2 }).default("0").notNull(),
    budget: numeric("budget", { precision: 14, scale: 2 }).default("0").notNull(),
    /**
     * Site progress 0-100, entered by the PM rather than derived from tasks.
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
  ],
);

export const task = pgTable(
  "task",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<TaskStatus>().default("todo").notNull(),
    priority: text("priority").$type<TaskPriority>().default("medium").notNull(),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    isMilestone: boolean("is_milestone").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("task_projectId_idx").on(table.projectId),
    index("task_assigneeId_idx").on(table.assigneeId),
    index("task_status_idx").on(table.status),
  ],
);

export const material = pgTable(
  "material",
  {
    id: id(),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    /** Unit of measure: bag, m3, ton, piece… */
    unit: text("unit").notNull(),
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 2 }).default("0").notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).default("0").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("material_name_idx").on(table.name)],
);

/**
 * The ledger that stock is derived from. There is intentionally no
 * `quantity_on_hand` column on `material`: the Neon HTTP driver has no
 * interactive transactions, so an insert-here-plus-update-there pair could
 * half-succeed and leave the counter permanently wrong. Summing this table is
 * always correct and cheap at this scale.
 */
export const materialMovement = pgTable(
  "material_movement",
  {
    id: id(),
    materialId: text("material_id")
      .notNull()
      .references(() => material.id, { onDelete: "cascade" }),
    /** Which site consumed or received it. Null for central-store adjustments. */
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    type: text("type").$type<MovementType>().notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    note: text("note"),
    recordedById: text("recorded_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    index("materialMovement_materialId_idx").on(table.materialId),
    index("materialMovement_projectId_idx").on(table.projectId),
  ],
);

export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    category: text("category"),
    status: text("status").$type<EquipmentStatus>().default("available").notNull(),
    /** Site it is currently deployed to. */
    projectId: text("project_id").references(() => project.id, { onDelete: "set null" }),
    purchaseDate: date("purchase_date"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("equipment_status_idx").on(table.status),
    index("equipment_projectId_idx").on(table.projectId),
  ],
);

export const expense = pgTable(
  "expense",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    category: text("category").$type<ExpenseCategory>().notNull(),
    description: text("description").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    incurredOn: date("incurred_on").notNull(),
    recordedById: text("recorded_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("expense_projectId_idx").on(table.projectId),
    index("expense_category_idx").on(table.category),
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
 * stored: it is derived on read, for the same reason materialMovement has no
 * quantity_on_hand column.
 */
export const boqVersion = pgTable(
  "boq_version",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<BoqVersionStatus>().default("draft").notNull(),
    /** Sum of leaf values, cached at recalc time for display only. */
    totalValue: numeric("total_value", { precision: 20, scale: 2 }),
    baselinedAt: timestamp("baselined_at"),
    baselinedById: text("baselined_by_id").references(() => user.id, { onDelete: "set null" }),
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
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Soft delete: a removed line still has progress history pointing at it. */
    deletedAt: timestamp("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("boqItem_boqVersionId_idx").on(table.boqVersionId),
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

export const notePhoto = pgTable(
  "note_photo",
  {
    id: id(),
    noteId: text("note_id")
      .notNull()
      .references(() => projectNote.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Blob key — required to delete the object, not derivable from the URL. */
    pathname: text("pathname").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    createdAt: createdAt(),
  },
  (table) => [index("notePhoto_noteId_idx").on(table.noteId)],
);

export const ACTIVITY_ENTITIES = [
  "project",
  "task",
  "material",
  "equipment",
  "expense",
  "note",
  "user",
  "boq",
  "period",
  "progress",
] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

export const ACTIVITY_ACTIONS = [
  "created",
  "deleted",
  "assigned",
  "status_changed",
  "movement_recorded",
  "paused",
  "resumed",
  "role_changed",
  "baselined",
  "generated",
  "progress_recorded",
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
  ],
);

export const projectRelations = relations(project, ({ one, many }) => ({
  manager: one(user, { fields: [project.managerId], references: [user.id] }),
  tasks: many(task),
  expenses: many(expense),
  equipment: many(equipment),
  materialMovements: many(materialMovement),
  notes: many(projectNote),
  boqVersions: many(boqVersion),
  reportingPeriods: many(reportingPeriod),
  progressEntries: many(progressEntry),
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

export const taskRelations = relations(task, ({ one }) => ({
  project: one(project, { fields: [task.projectId], references: [project.id] }),
  assignee: one(user, { fields: [task.assigneeId], references: [user.id] }),
}));

export const materialRelations = relations(material, ({ many }) => ({
  movements: many(materialMovement),
}));

export const materialMovementRelations = relations(materialMovement, ({ one }) => ({
  material: one(material, { fields: [materialMovement.materialId], references: [material.id] }),
  project: one(project, { fields: [materialMovement.projectId], references: [project.id] }),
  recordedBy: one(user, { fields: [materialMovement.recordedById], references: [user.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one }) => ({
  project: one(project, { fields: [equipment.projectId], references: [project.id] }),
}));

export const expenseRelations = relations(expense, ({ one }) => ({
  project: one(project, { fields: [expense.projectId], references: [project.id] }),
  recordedBy: one(user, { fields: [expense.recordedById], references: [user.id] }),
}));
