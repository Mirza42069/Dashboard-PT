import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import {
  bytea,
  boqImport,
  boqItem,
  boqVersion,
  createdAt,
  id,
  project,
  reportingPeriod,
  ticket,
  updatedAt,
} from "./construction";

/**
 * Field reporting: what happened on site, day by day.
 *
 * Separate file from construction.ts because that one is already the whole
 * planning and progress domain and this is a different question — not "how far
 * along is the contract" but "what happened on Tuesday". They meet in two
 * places, both deliberate: a daily report names the reporting period it falls
 * in, and an action can point at the report that raised it.
 *
 * Same conventions throughout: text primary keys, snake_case columns, plain
 * calendar `date` for anything a person would write on a form, and actor-name
 * snapshots beside every actor id so a removed account does not erase who did
 * what.
 */

export const DAILY_REPORT_STATUSES = [
  "draft",
  "submitted",
  "reviewed",
  "approved",
  "returned",
] as const;
export type DailyReportStatus = (typeof DAILY_REPORT_STATUSES)[number];

/**
 * Weather as a small closed set rather than free text.
 *
 * A daily report's weather is evidence — it is what a delay claim rests on —
 * and "rainy", "Rain", "hujan" and "wet" typed across six months cannot be
 * counted. The free-text note beside it carries anything this cannot.
 */
export const WEATHER_CONDITIONS = [
  "clear",
  "cloudy",
  "light_rain",
  "heavy_rain",
  "storm",
  "extreme_heat",
] as const;
export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

export const dailyReport = pgTable(
  "daily_report",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    reportDate: date("report_date").notNull(),
    /**
     * The reporting period this day falls inside, resolved at write time.
     *
     * Stored rather than derived on read so a report keeps the period it was
     * filed against even if the axis is later rebuilt — and so "show me the
     * daily reports behind week 12" is an index lookup rather than a date-range
     * scan per period.
     */
    periodId: text("period_id").references(() => reportingPeriod.id, { onDelete: "set null" }),

    weather: text("weather").$type<WeatherCondition>(),
    weatherNote: text("weather_note"),
    /** Rain hours, if any were lost. Null means nobody recorded it. */
    rainfallHours: numeric("rainfall_hours", { precision: 5, scale: 2 }),

    workPerformed: text("work_performed"),
    delays: text("delays"),
    safetyObservations: text("safety_observations"),
    qualityObservations: text("quality_observations"),
    visitors: text("visitors"),
    notes: text("notes"),

    status: text("status").$type<DailyReportStatus>().default("draft").notNull(),
    preparedById: text("prepared_by_id").references(() => user.id, { onDelete: "set null" }),
    preparedByName: text("prepared_by_name").notNull(),
    submittedAt: timestamp("submitted_at"),
    reviewedById: text("reviewed_by_id").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    approvedById: text("approved_by_id").references(() => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    returnReason: text("return_reason"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One report per site per day. A second Tuesday is a correction to the
    // first, not a second Tuesday — the workflow reopens the existing one.
    uniqueIndex("dailyReport_project_date_idx").on(table.projectId, table.reportDate),
    index("dailyReport_projectId_status_idx").on(table.projectId, table.status),
    index("dailyReport_periodId_idx").on(table.periodId),
  ],
);

/**
 * One dated progress worksheet imported from a contractor workbook.
 *
 * This is deliberately separate from progressEntry. A weekly reporting period
 * can contain several daily readings, while progressEntry has one canonical
 * reading per item and period. Keeping the source readings here preserves that
 * history without changing the reporting cadence used by the S-curve.
 */
export const dailyProgressSnapshot = pgTable(
  "daily_progress_snapshot",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    periodId: text("period_id")
      .notNull()
      .references(() => reportingPeriod.id, { onDelete: "cascade" }),
    boqVersionId: text("boq_version_id")
      .notNull()
      .references(() => boqVersion.id, { onDelete: "cascade" }),
    boqImportId: text("boq_import_id").references(() => boqImport.id, { onDelete: "set null" }),
    reportDate: date("report_date").notNull(),
    cumulativePercent: numeric("cumulative_percent", { precision: 9, scale: 6 }).notNull(),
    sourceFilename: text("source_filename").notNull(),
    sourceSheetName: text("source_sheet_name").notNull(),
    sourceHeaderRow: integer("source_header_row").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("dailyProgressSnapshot_project_date_idx").on(table.projectId, table.reportDate),
    unique("dailyProgressSnapshot_project_id_idx").on(table.projectId, table.id),
    index("dailyProgressSnapshot_periodId_idx").on(table.periodId),
    index("dailyProgressSnapshot_boqVersionId_idx").on(table.boqVersionId),
    index("dailyProgressSnapshot_boqImportId_idx").on(table.boqImportId),
    foreignKey({
      columns: [table.projectId, table.periodId],
      foreignColumns: [reportingPeriod.projectId, reportingPeriod.id],
      name: "daily_progress_snapshot_project_period_fk",
    }).onDelete("cascade"),
    check(
      "daily_progress_snapshot_percent_check",
      sql`${table.cumulativePercent} between 0 and 100`,
    ),
    check("daily_progress_snapshot_header_row_check", sql`${table.sourceHeaderRow} > 0`),
  ],
);

/** Full source line behind a dated progress snapshot. */
export const dailyProgressItem = pgTable(
  "daily_progress_item",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => dailyProgressSnapshot.id, { onDelete: "cascade" }),
    /** Optional because detailed daily lines can be finer than the S-curve baseline. */
    boqItemId: text("boq_item_id").references(() => boqItem.id, { onDelete: "set null" }),
    sourceRow: integer("source_row").notNull(),
    code: text("code"),
    description: text("description").notNull(),
    sectionCode: text("section_code"),
    sectionDescription: text("section_description"),
    parentCode: text("parent_code"),
    parentDescription: text("parent_description"),
    unit: text("unit"),
    quantity: numeric("quantity", { precision: 24, scale: 8 }),
    unitRate: numeric("unit_rate", { precision: 24, scale: 8 }),
    amount: numeric("amount", { precision: 26, scale: 8 }),
    weight: numeric("weight", { precision: 9, scale: 6 }).notNull(),
    previousPercent: numeric("previous_percent", { precision: 9, scale: 6 }),
    currentPercent: numeric("current_percent", { precision: 9, scale: 6 }),
    cumulativePercent: numeric("cumulative_percent", { precision: 9, scale: 6 }).notNull(),
    remainingPercent: numeric("remaining_percent", { precision: 9, scale: 6 }),
    previousWeighted: numeric("previous_weighted", { precision: 12, scale: 8 }),
    currentWeighted: numeric("current_weighted", { precision: 12, scale: 8 }),
    cumulativeWeighted: numeric("cumulative_weighted", { precision: 12, scale: 8 }).notNull(),
    remainingWeighted: numeric("remaining_weighted", { precision: 12, scale: 8 }),
    remark: text("remark"),
    /** Exact normalized source cells, including optional columns mapped by AI. */
    sourceValues: jsonb("source_values").$type<Record<string, string | number | null>>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("dailyProgressItem_snapshot_row_idx").on(table.snapshotId, table.sourceRow),
    index("dailyProgressItem_projectId_idx").on(table.projectId),
    index("dailyProgressItem_boqItemId_idx").on(table.boqItemId),
    foreignKey({
      columns: [table.projectId, table.snapshotId],
      foreignColumns: [dailyProgressSnapshot.projectId, dailyProgressSnapshot.id],
      name: "daily_progress_item_project_snapshot_fk",
    }).onDelete("cascade"),
    check("daily_progress_item_source_row_check", sql`${table.sourceRow} > 0`),
    check("daily_progress_item_weight_check", sql`${table.weight} between 0 and 100`),
    check(
      "daily_progress_item_percent_check",
      sql`(${table.previousPercent} is null or ${table.previousPercent} between 0 and 100)
        and (${table.currentPercent} is null or ${table.currentPercent} between 0 and 100)
        and ${table.cumulativePercent} between 0 and 100
        and (${table.remainingPercent} is null or ${table.remainingPercent} between 0 and 100)`,
    ),
  ],
);

/**
 * Heads on site, by trade.
 *
 * A row per trade rather than a single number, because the number alone answers
 * nothing: "42 people" and "42 people of whom 2 were steel fixers on a week the
 * frame is critical" are different reports.
 */
export const dailyReportManpower = pgTable(
  "daily_report_manpower",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    trade: text("trade").notNull(),
    headcount: integer("headcount").default(0).notNull(),
    /** Total hours worked by this trade. Null where only headcount was taken. */
    hours: numeric("hours", { precision: 8, scale: 2 }),
    note: text("note"),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [index("dailyReportManpower_reportId_idx").on(table.reportId)],
);

export const dailyReportEquipment = pgTable(
  "daily_report_equipment",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    hoursUsed: numeric("hours_used", { precision: 8, scale: 2 }),
    /** On site but not working — the figure that turns into a standing charge. */
    idle: boolean("idle").default(false).notNull(),
    note: text("note"),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [index("dailyReportEquipment_reportId_idx").on(table.reportId)],
);

export const dailyReportDelivery = pgTable(
  "daily_report_delivery",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    material: text("material").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 4 }),
    unit: text("unit"),
    supplier: text("supplier"),
    /** Delivery note or docket number, which is what a dispute is settled by. */
    reference: text("reference"),
    /** Optional link to the priced line the material was delivered against. */
    boqItemId: text("boq_item_id").references(() => boqItem.id, { onDelete: "set null" }),
    note: text("note"),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [index("dailyReportDelivery_reportId_idx").on(table.reportId)],
);

/** Site photographs attached to a day's report. Same storage as notePhoto. */
export const dailyReportPhoto = pgTable(
  "daily_report_photo",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    data: bytea("data").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size"),
    caption: text("caption"),
    createdAt: createdAt(),
  },
  (table) => [index("dailyReportPhoto_reportId_idx").on(table.reportId)],
);

/** Every move a daily report has made. Append-only, like the period's log. */
export const dailyReportEvent = pgTable(
  "daily_report_event",
  {
    id: id(),
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    fromStatus: text("from_status").$type<DailyReportStatus>().notNull(),
    toStatus: text("to_status").$type<DailyReportStatus>().notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (table) => [index("dailyReportEvent_reportId_idx").on(table.reportId)],
);

/* ------------------------------------------------------------------ actions */

/**
 * Actions raised from a day's report.
 *
 * A join table rather than a column on `ticket`, for two reasons. The honest
 * one: a report raises several actions and an action can be evidenced by more
 * than one day's report, so the relationship is genuinely many-to-many. The
 * structural one: `ticket` lives in ./construction.ts, and pointing it at a
 * table in this file would make the two modules import each other.
 */
export const dailyReportAction = pgTable(
  "daily_report_action",
  {
    reportId: text("report_id")
      .notNull()
      .references(() => dailyReport.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: "daily_report_action_pk", columns: [table.reportId, table.ticketId] }),
    index("dailyReportAction_ticketId_idx").on(table.ticketId),
  ],
);

/**
 * Discussion on an action. Separate rows rather than an appended text blob so
 * each remark keeps its author and time, and so a comment cannot be quietly
 * edited into a different comment.
 */
export const ticketComment = pgTable(
  "ticket_comment",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("ticketComment_ticketId_idx").on(table.ticketId)],
);

/** People who want to hear about this action without owning it. */
export const ticketWatcher = pgTable(
  "ticket_watcher",
  {
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ name: "ticket_watcher_pk", columns: [table.ticketId, table.userId] }),
    index("ticketWatcher_userId_idx").on(table.userId),
  ],
);

/**
 * Field-level history: what changed, from what, to what, by whom.
 *
 * Distinct from activityLog, which is the company-wide feed. This is the
 * per-action record a dispute is reconstructed from, and it stores the values
 * rather than a sentence so it renders in whichever language the reader picked.
 */
export const ticketEvent = pgTable(
  "ticket_event",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("ticketEvent_ticketId_idx").on(table.ticketId)],
);

export const ticketAttachment = pgTable(
  "ticket_attachment",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => ticket.id, { onDelete: "cascade" }),
    data: bytea("data").notNull(),
    contentType: text("content_type").notNull(),
    filename: text("filename").notNull(),
    size: integer("size"),
    uploadedById: text("uploaded_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [index("ticketAttachment_ticketId_idx").on(table.ticketId)],
);

/**
 * In-app notifications.
 *
 * Deliberately a plain event store with a read marker and no delivery channel
 * attached. Email needs addresses, bounce handling, unsubscribe and a sending
 * domain, none of which were asked for — and a table shaped like this is what a
 * mailer would read from later anyway. Rows are written by the same code paths
 * that already record activity, so nothing here needs a background worker.
 */
export const NOTIFICATION_KINDS = [
  "action_assigned",
  "action_commented",
  "action_due",
  "action_closed",
  "report_submitted",
  "report_returned",
  "report_approved",
  "support_accepted",
  "support_replied",
  "support_closed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notification = pgTable(
  "notification",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Scoping column, so a company switch cannot leak another tenant's feed. */
    companyId: text("company_id").notNull(),
    projectId: text("project_id").references(() => project.id, { onDelete: "cascade" }),
    kind: text("kind").$type<NotificationKind>().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    /** Label captured now — the entity may be gone when this is read. */
    entityLabel: text("entity_label").notNull(),
    detail: text("detail"),
    actorName: text("actor_name"),
    readAt: timestamp("read_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("notification_user_read_idx").on(table.userId, table.readAt),
    index("notification_createdAt_idx").on(table.createdAt),
  ],
);

/* ---------------------------------------------------------------- relations */

export const dailyReportRelations = relations(dailyReport, ({ one, many }) => ({
  project: one(project, { fields: [dailyReport.projectId], references: [project.id] }),
  period: one(reportingPeriod, {
    fields: [dailyReport.periodId],
    references: [reportingPeriod.id],
  }),
  preparedBy: one(user, { fields: [dailyReport.preparedById], references: [user.id] }),
  manpower: many(dailyReportManpower),
  equipment: many(dailyReportEquipment),
  deliveries: many(dailyReportDelivery),
  photos: many(dailyReportPhoto),
  events: many(dailyReportEvent),
  actions: many(dailyReportAction),
}));

export const dailyReportManpowerRelations = relations(dailyReportManpower, ({ one }) => ({
  report: one(dailyReport, { fields: [dailyReportManpower.reportId], references: [dailyReport.id] }),
}));

export const dailyReportEquipmentRelations = relations(dailyReportEquipment, ({ one }) => ({
  report: one(dailyReport, {
    fields: [dailyReportEquipment.reportId],
    references: [dailyReport.id],
  }),
}));

export const dailyReportDeliveryRelations = relations(dailyReportDelivery, ({ one }) => ({
  report: one(dailyReport, { fields: [dailyReportDelivery.reportId], references: [dailyReport.id] }),
  item: one(boqItem, { fields: [dailyReportDelivery.boqItemId], references: [boqItem.id] }),
}));

export const dailyReportPhotoRelations = relations(dailyReportPhoto, ({ one }) => ({
  report: one(dailyReport, { fields: [dailyReportPhoto.reportId], references: [dailyReport.id] }),
}));

export const dailyReportEventRelations = relations(dailyReportEvent, ({ one }) => ({
  report: one(dailyReport, { fields: [dailyReportEvent.reportId], references: [dailyReport.id] }),
}));

export const dailyReportActionRelations = relations(dailyReportAction, ({ one }) => ({
  report: one(dailyReport, { fields: [dailyReportAction.reportId], references: [dailyReport.id] }),
  ticket: one(ticket, { fields: [dailyReportAction.ticketId], references: [ticket.id] }),
}));

export const ticketCommentRelations = relations(ticketComment, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketComment.ticketId], references: [ticket.id] }),
  author: one(user, { fields: [ticketComment.authorId], references: [user.id] }),
}));

export const ticketWatcherRelations = relations(ticketWatcher, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketWatcher.ticketId], references: [ticket.id] }),
  user: one(user, { fields: [ticketWatcher.userId], references: [user.id] }),
}));

export const ticketEventRelations = relations(ticketEvent, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketEvent.ticketId], references: [ticket.id] }),
}));

export const ticketAttachmentRelations = relations(ticketAttachment, ({ one }) => ({
  ticket: one(ticket, { fields: [ticketAttachment.ticketId], references: [ticket.id] }),
}));

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, { fields: [notification.userId], references: [user.id] }),
  project: one(project, { fields: [notification.projectId], references: [project.id] }),
}));
