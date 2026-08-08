import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { company } from "./company";

/** A company is the clinic boundary; the MVP deliberately has no multi-location layer. */

export const PATIENT_SEXES = ["female", "male", "other", "unknown"] as const;
export const APPOINTMENT_STATUSES = [
  "scheduled",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;
export const TREATMENT_PLAN_STATUSES = [
  "draft",
  "presented",
  "accepted",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const TREATMENT_ITEM_STATUSES = [
  "planned",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const;
export const PAYMENT_STATUSES = ["pending", "completed", "refunded", "void"] as const;
export const PAYMENT_METHODS = [
  "cash",
  "card",
  "bank_transfer",
  "insurance",
  "other",
] as const;

export type PatientSex = (typeof PATIENT_SEXES)[number];
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];
export type TreatmentItemStatus = (typeof TREATMENT_ITEM_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const companyId = () =>
  text("company_id")
    .notNull()
    .references(() => company.id, { onDelete: "restrict" });
const createdAt = () => timestamp("created_at").defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const dentalPatient = pgTable(
  "dental_patient",
  {
    id: id(),
    companyId: companyId(),
    recordNumber: text("record_number").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    preferredName: text("preferred_name"),
    dateOfBirth: date("date_of_birth"),
    sex: text("sex").$type<PatientSex>().default("unknown").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    medicalAlerts: text("medical_alerts"),
    allergies: text("allergies"),
    medications: text("medications"),
    notes: text("notes"),
    archivedAt: timestamp("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("dental_patient_company_record_key").on(table.companyId, table.recordNumber),
    unique("dental_patient_company_id_key").on(table.companyId, table.id),
    index("dental_patient_company_name_idx").on(table.companyId, table.lastName, table.firstName),
    index("dental_patient_company_archived_idx").on(table.companyId, table.archivedAt),
    check("dental_patient_sex_check", sql`${table.sex} in ('female', 'male', 'other', 'unknown')`),
  ],
);

export const dentalPractitioner = pgTable(
  "dental_practitioner",
  {
    id: id(),
    companyId: companyId(),
    userId: text("user_id").notNull(),
    providerCode: text("provider_code").notNull(),
    displayName: text("display_name").notNull(),
    specialty: text("specialty"),
    phone: text("phone"),
    color: text("color"),
    active: boolean("active").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("dental_practitioner_company_user_key").on(table.companyId, table.userId),
    unique("dental_practitioner_company_code_key").on(table.companyId, table.providerCode),
    unique("dental_practitioner_company_id_key").on(table.companyId, table.id),
    foreignKey({
      name: "dental_practitioner_company_user_fk",
      columns: [table.companyId, table.userId],
      foreignColumns: [user.companyId, user.id],
    }).onDelete("restrict"),
    index("dental_practitioner_company_active_idx").on(table.companyId, table.active),
  ],
);

export const dentalAppointment = pgTable(
  "dental_appointment",
  {
    id: id(),
    companyId: companyId(),
    patientId: text("patient_id").notNull(),
    practitionerId: text("practitioner_id").notNull(),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at").notNull(),
    status: text("status").$type<AppointmentStatus>().default("scheduled").notNull(),
    appointmentType: text("appointment_type").notNull(),
    reason: text("reason"),
    notes: text("notes"),
    cancellationReason: text("cancellation_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("dental_appointment_company_id_key").on(table.companyId, table.id),
    foreignKey({
      name: "dental_appointment_company_patient_fk",
      columns: [table.companyId, table.patientId],
      foreignColumns: [dentalPatient.companyId, dentalPatient.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "dental_appointment_company_practitioner_fk",
      columns: [table.companyId, table.practitionerId],
      foreignColumns: [dentalPractitioner.companyId, dentalPractitioner.id],
    }).onDelete("restrict"),
    index("dental_appointment_company_start_idx").on(table.companyId, table.startsAt),
    index("dental_appointment_company_status_start_idx").on(
      table.companyId,
      table.status,
      table.startsAt,
    ),
    index("dental_appointment_patient_start_idx").on(table.patientId, table.startsAt),
    index("dental_appointment_practitioner_start_idx").on(table.practitionerId, table.startsAt),
    check("dental_appointment_time_check", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "dental_appointment_status_check",
      sql`${table.status} in ('scheduled', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show')`,
    ),
  ],
);

export const dentalTreatmentPlan = pgTable(
  "dental_treatment_plan",
  {
    id: id(),
    companyId: companyId(),
    patientId: text("patient_id").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<TreatmentPlanStatus>().default("draft").notNull(),
    notes: text("notes"),
    presentedAt: timestamp("presented_at"),
    acceptedAt: timestamp("accepted_at"),
    completedAt: timestamp("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("dental_treatment_plan_company_id_key").on(table.companyId, table.id),
    foreignKey({
      name: "dental_treatment_plan_company_patient_fk",
      columns: [table.companyId, table.patientId],
      foreignColumns: [dentalPatient.companyId, dentalPatient.id],
    }).onDelete("restrict"),
    index("dental_treatment_plan_company_status_idx").on(table.companyId, table.status),
    index("dental_treatment_plan_patient_idx").on(table.patientId),
    check(
      "dental_treatment_plan_status_check",
      sql`${table.status} in ('draft', 'presented', 'accepted', 'in_progress', 'completed', 'cancelled')`,
    ),
  ],
);

export const dentalTreatmentItem = pgTable(
  "dental_treatment_item",
  {
    id: id(),
    companyId: companyId(),
    treatmentPlanId: text("treatment_plan_id").notNull(),
    appointmentId: text("appointment_id"),
    procedureCode: text("procedure_code").notNull(),
    procedureName: text("procedure_name").notNull(),
    toothNumber: text("tooth_number"),
    status: text("status").$type<TreatmentItemStatus>().default("planned").notNull(),
    fee: money("fee").notNull(),
    notes: text("notes"),
    completedAt: timestamp("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "dental_treatment_item_company_plan_fk",
      columns: [table.companyId, table.treatmentPlanId],
      foreignColumns: [dentalTreatmentPlan.companyId, dentalTreatmentPlan.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "dental_treatment_item_company_appointment_fk",
      columns: [table.companyId, table.appointmentId],
      foreignColumns: [dentalAppointment.companyId, dentalAppointment.id],
    }).onDelete("restrict"),
    index("dental_treatment_item_company_status_idx").on(table.companyId, table.status),
    index("dental_treatment_item_plan_idx").on(table.treatmentPlanId),
    index("dental_treatment_item_appointment_idx").on(table.appointmentId),
    index("dental_treatment_item_completed_idx").on(table.companyId, table.completedAt),
    check("dental_treatment_item_fee_check", sql`${table.fee} >= 0`),
    check(
      "dental_treatment_item_status_check",
      sql`${table.status} in ('planned', 'scheduled', 'in_progress', 'completed', 'cancelled')`,
    ),
  ],
);

export const dentalPayment = pgTable(
  "dental_payment",
  {
    id: id(),
    companyId: companyId(),
    patientId: text("patient_id").notNull(),
    treatmentPlanId: text("treatment_plan_id"),
    appointmentId: text("appointment_id"),
    amount: money("amount").notNull(),
    status: text("status").$type<PaymentStatus>().default("completed").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    reference: text("reference"),
    notes: text("notes"),
    paidAt: timestamp("paid_at").notNull(),
    receivedById: text("received_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      name: "dental_payment_company_patient_fk",
      columns: [table.companyId, table.patientId],
      foreignColumns: [dentalPatient.companyId, dentalPatient.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "dental_payment_company_plan_fk",
      columns: [table.companyId, table.treatmentPlanId],
      foreignColumns: [dentalTreatmentPlan.companyId, dentalTreatmentPlan.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "dental_payment_company_appointment_fk",
      columns: [table.companyId, table.appointmentId],
      foreignColumns: [dentalAppointment.companyId, dentalAppointment.id],
    }).onDelete("restrict"),
    index("dental_payment_company_paid_idx").on(table.companyId, table.paidAt),
    index("dental_payment_patient_paid_idx").on(table.patientId, table.paidAt),
    index("dental_payment_plan_idx").on(table.treatmentPlanId),
    check("dental_payment_amount_check", sql`${table.amount} > 0`),
    check(
      "dental_payment_status_check",
      sql`${table.status} in ('pending', 'completed', 'refunded', 'void')`,
    ),
    check(
      "dental_payment_method_check",
      sql`${table.method} in ('cash', 'card', 'bank_transfer', 'insurance', 'other')`,
    ),
  ],
);
