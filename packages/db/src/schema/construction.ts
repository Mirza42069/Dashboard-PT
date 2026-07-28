import { relations } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
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

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type MovementType = (typeof MOVEMENT_TYPES)[number];
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

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
    contractValue: numeric("contract_value", { precision: 14, scale: 2 }).default("0").notNull(),
    budget: numeric("budget", { precision: 14, scale: 2 }).default("0").notNull(),
    /** Site progress 0-100, entered by the PM rather than derived from tasks. */
    progress: integer("progress").default(0).notNull(),
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
    companyId: companyId(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    /** Unit of measure: bag, m3, ton, piece… */
    unit: text("unit").notNull(),
    reorderLevel: numeric("reorder_level", { precision: 12, scale: 2 }).default("0").notNull(),
    unitCost: numeric("unit_cost", { precision: 14, scale: 2 }).default("0").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("material_name_idx").on(table.name),
    index("material_companyId_idx").on(table.companyId),
    unique("material_companyId_sku_key").on(table.companyId, table.sku),
  ],
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
    companyId: companyId(),
    code: text("code").notNull(),
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
    index("equipment_companyId_idx").on(table.companyId),
    unique("equipment_companyId_code_key").on(table.companyId, table.code),
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
  "task",
  "material",
  "equipment",
  "expense",
  "note",
  "user",
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
  materials: many(material),
  equipment: many(equipment),
  users: many(user),
}));

export const projectRelations = relations(project, ({ one, many }) => ({
  company: one(company, { fields: [project.companyId], references: [company.id] }),
  manager: one(user, { fields: [project.managerId], references: [user.id] }),
  tasks: many(task),
  expenses: many(expense),
  equipment: many(equipment),
  materialMovements: many(materialMovement),
  notes: many(projectNote),
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

export const materialRelations = relations(material, ({ one, many }) => ({
  company: one(company, { fields: [material.companyId], references: [company.id] }),
  movements: many(materialMovement),
}));

export const materialMovementRelations = relations(materialMovement, ({ one }) => ({
  material: one(material, { fields: [materialMovement.materialId], references: [material.id] }),
  project: one(project, { fields: [materialMovement.projectId], references: [project.id] }),
  recordedBy: one(user, { fields: [materialMovement.recordedById], references: [user.id] }),
}));

export const equipmentRelations = relations(equipment, ({ one }) => ({
  company: one(company, { fields: [equipment.companyId], references: [company.id] }),
  project: one(project, { fields: [equipment.projectId], references: [project.id] }),
}));

export const expenseRelations = relations(expense, ({ one }) => ({
  project: one(project, { fields: [expense.projectId], references: [project.id] }),
  recordedBy: one(user, { fields: [expense.recordedById], references: [user.id] }),
}));
