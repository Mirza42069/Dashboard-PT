import { db } from "@DashboardV2/db";
import {
  APPOINTMENT_STATUSES,
  PATIENT_SEXES,
  PAYMENT_METHODS,
  TREATMENT_ITEM_STATUSES,
  TREATMENT_PLAN_STATUSES,
  dentalAppointment,
  dentalPatient,
  dentalPayment,
  dentalPractitioner,
  dentalTreatmentItem,
  dentalTreatmentPlan,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import z from "zod";

import { companyVerticalPermissionProcedure, router } from "../index";
import { calculateDentalDashboard } from "../lib/dental-dashboard";
import { toAmount } from "../lib/money";
import { assertUserAssignable } from "../lib/scope";

const readProcedure = companyVerticalPermissionProcedure("dental", "dental:read");
const writeProcedure = companyVerticalPermissionProcedure("dental", "dental:write");
const settingsProcedure = companyVerticalPermissionProcedure("dental", "dental:settings");
const deleteProcedure = companyVerticalPermissionProcedure("dental", "dental:delete");

const idSchema = z.string().min(1);
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const dateTimeSchema = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const nullableDateTimeSchema = dateTimeSchema.nullable().optional();
const feeSchema = z.number().finite().min(0).max(999_999_999_999.99);
const paymentAmountSchema = z.number().finite().positive().max(999_999_999_999.99);

function hasChanges(input: Record<string, unknown>) {
  return Object.entries(input).some(([key, value]) => key !== "id" && value !== undefined);
}

const patientFields = z.object({
  recordNumber: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  preferredName: nullableText(100),
  dateOfBirth: z.iso.date().nullable().optional(),
  sex: z.enum(PATIENT_SEXES).optional(),
  phone: nullableText(40),
  email: z.email().max(254).nullable().optional(),
  address: nullableText(1000),
  emergencyContactName: nullableText(200),
  emergencyContactPhone: nullableText(40),
  medicalAlerts: nullableText(2000),
  allergies: nullableText(2000),
  medications: nullableText(2000),
  notes: nullableText(5000),
});

const practitionerFields = z.object({
  userId: idSchema,
  providerCode: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(1).max(160),
  specialty: nullableText(120),
  phone: nullableText(40),
  color: z.string().trim().max(32).nullable().optional(),
  active: z.boolean().optional(),
});

const appointmentFields = z.object({
  patientId: idSchema,
  practitionerId: idSchema,
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  appointmentType: z.string().trim().min(1).max(120),
  reason: nullableText(1000),
  notes: nullableText(5000),
  cancellationReason: nullableText(1000),
});

const planFields = z.object({
  patientId: idSchema,
  title: z.string().trim().min(1).max(200),
  status: z.enum(TREATMENT_PLAN_STATUSES).optional(),
  notes: nullableText(5000),
});

const itemFields = z.object({
  appointmentId: idSchema.nullable().optional(),
  procedureCode: z.string().trim().min(1).max(40),
  procedureName: z.string().trim().min(1).max(200),
  toothNumber: nullableText(20),
  status: z.enum(TREATMENT_ITEM_STATUSES).optional(),
  fee: feeSchema,
  notes: nullableText(2000),
  completedAt: nullableDateTimeSchema,
});

function requireDateOrder(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Appointment end must be after start" });
  }
}

async function requirePatient(companyId: string, id: string) {
  const [row] = await db
    .select({ id: dentalPatient.id })
    .from(dentalPatient)
    .where(and(eq(dentalPatient.companyId, companyId), eq(dentalPatient.id, id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });
  return row;
}

async function requirePractitioner(companyId: string, id: string) {
  const [row] = await db
    .select({ id: dentalPractitioner.id })
    .from(dentalPractitioner)
    .where(and(eq(dentalPractitioner.companyId, companyId), eq(dentalPractitioner.id, id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Practitioner not found" });
  return row;
}

async function requireAppointment(companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(dentalAppointment)
    .where(and(eq(dentalAppointment.companyId, companyId), eq(dentalAppointment.id, id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Appointment not found" });
  return row;
}

async function requirePractitionerAvailable(
  companyId: string,
  practitionerId: string,
  startsAt: Date,
  endsAt: Date,
  excludeAppointmentId?: string,
) {
  const [overlap] = await db
    .select({ id: dentalAppointment.id })
    .from(dentalAppointment)
    .where(
      and(
        eq(dentalAppointment.companyId, companyId),
        eq(dentalAppointment.practitionerId, practitionerId),
        notInArray(dentalAppointment.status, ["cancelled", "no_show"]),
        lt(dentalAppointment.startsAt, endsAt),
        gt(dentalAppointment.endsAt, startsAt),
        excludeAppointmentId ? ne(dentalAppointment.id, excludeAppointmentId) : undefined,
      ),
    );
  if (overlap) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "The practitioner already has an appointment during this time",
    });
  }
}

async function requirePlan(companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(dentalTreatmentPlan)
    .where(and(eq(dentalTreatmentPlan.companyId, companyId), eq(dentalTreatmentPlan.id, id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Treatment plan not found" });
  return row;
}

function utcRanges(day: string) {
  const todayStart = new Date(`${day}T00:00:00.000Z`);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const monthStart = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(todayStart.getUTCFullYear(), todayStart.getUTCMonth() + 1, 1));
  return { todayStart, todayEnd, monthStart, monthEnd };
}

const dashboardRouter = router({
  summary: readProcedure
    .input(z.object({ date: z.iso.date().optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const day = input.date ?? new Date().toISOString().slice(0, 10);
      const ranges = utcRanges(day);
      const companyFilter = eq(dentalAppointment.companyId, ctx.companyId);

      const [patients, practitioners, appointments, treatmentItems, payments, schedule] =
        await Promise.all([
          db
            .select({
              id: dentalPatient.id,
              createdAt: dentalPatient.createdAt,
              medicalAlerts: dentalPatient.medicalAlerts,
              allergies: dentalPatient.allergies,
            })
            .from(dentalPatient)
            .where(eq(dentalPatient.companyId, ctx.companyId)),
          db
            .select({ id: dentalPractitioner.id, displayName: dentalPractitioner.displayName })
            .from(dentalPractitioner)
            .where(
              and(eq(dentalPractitioner.companyId, ctx.companyId), eq(dentalPractitioner.active, true)),
            ),
          db
            .select()
            .from(dentalAppointment)
            .where(
              and(
                companyFilter,
                gte(dentalAppointment.startsAt, ranges.todayStart),
                lt(dentalAppointment.startsAt, ranges.todayEnd),
              ),
            ),
          db
            .select({
              fee: dentalTreatmentItem.fee,
              status: dentalTreatmentItem.status,
              planStatus: dentalTreatmentPlan.status,
              appointmentId: dentalTreatmentItem.appointmentId,
              appointmentStartsAt: dentalAppointment.startsAt,
              completedAt: dentalTreatmentItem.completedAt,
            })
            .from(dentalTreatmentItem)
            .innerJoin(
              dentalTreatmentPlan,
              and(
                eq(dentalTreatmentPlan.companyId, dentalTreatmentItem.companyId),
                eq(dentalTreatmentPlan.id, dentalTreatmentItem.treatmentPlanId),
              ),
            )
            .leftJoin(
              dentalAppointment,
              and(
                eq(dentalAppointment.companyId, dentalTreatmentItem.companyId),
                eq(dentalAppointment.id, dentalTreatmentItem.appointmentId),
              ),
            )
            .where(eq(dentalTreatmentItem.companyId, ctx.companyId)),
          db.select().from(dentalPayment).where(eq(dentalPayment.companyId, ctx.companyId)),
          db
            .select({
              id: dentalAppointment.id,
              startsAt: dentalAppointment.startsAt,
              endsAt: dentalAppointment.endsAt,
              status: dentalAppointment.status,
              appointmentType: dentalAppointment.appointmentType,
              patientId: dentalPatient.id,
              patientFirstName: dentalPatient.firstName,
              patientLastName: dentalPatient.lastName,
              practitionerId: dentalPractitioner.id,
              practitionerName: dentalPractitioner.displayName,
            })
            .from(dentalAppointment)
            .innerJoin(
              dentalPatient,
              and(
                eq(dentalPatient.companyId, dentalAppointment.companyId),
                eq(dentalPatient.id, dentalAppointment.patientId),
              ),
            )
            .innerJoin(
              dentalPractitioner,
              and(
                eq(dentalPractitioner.companyId, dentalAppointment.companyId),
                eq(dentalPractitioner.id, dentalAppointment.practitionerId),
              ),
            )
            .where(
              and(
                companyFilter,
                gte(dentalAppointment.startsAt, ranges.todayStart),
                lt(dentalAppointment.startsAt, ranges.todayEnd),
              ),
            )
            .orderBy(asc(dentalAppointment.startsAt)),
        ]);

      const calculated = calculateDentalDashboard({
        ...ranges,
        patients,
        practitioners,
        appointments,
        treatmentItems,
        payments,
        patientsWithAlerts: new Set(
          patients
            .filter((row) => row.medicalAlerts?.trim() || row.allergies?.trim())
            .map((row) => row.id),
        ),
      });
      const names = new Map(practitioners.map((row) => [row.id, row.displayName]));

      return {
        date: day,
        todaysAppointmentCount: calculated.todaysAppointmentCount,
        appointmentStatuses: calculated.appointmentStatuses,
        newPatientsThisMonth: calculated.newPatientsThisMonth,
        monthlyPlannedProduction: calculated.monthlyPlannedProduction,
        monthlyCompletedProduction: calculated.monthlyCompletedProduction,
        monthlyCollections: calculated.monthlyCollections,
        outstandingBalance: calculated.outstandingBalance,
        schedule,
        practitionerUtilization: calculated.utilization.map((row) => ({
          ...row,
          practitionerName: names.get(row.practitionerId) ?? "Unknown practitioner",
        })),
        attention: calculated.attention,
      };
    }),
});

const patientsRouter = router({
  list: readProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dentalPatient.companyId, ctx.companyId),
        input.includeArchived ? undefined : isNull(dentalPatient.archivedAt),
        input.search
          ? or(
              ilike(dentalPatient.recordNumber, `%${input.search}%`),
              ilike(dentalPatient.firstName, `%${input.search}%`),
              ilike(dentalPatient.lastName, `%${input.search}%`),
              ilike(dentalPatient.phone, `%${input.search}%`),
              ilike(dentalPatient.email, `%${input.search}%`),
            )
          : undefined,
      );
      const [patients, [total]] = await Promise.all([
        db
          .select()
          .from(dentalPatient)
          .where(where)
          .orderBy(asc(dentalPatient.lastName), asc(dentalPatient.firstName))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(dentalPatient).where(where),
      ]);
      return { patients, total: total?.value ?? 0 };
    }),

  get: readProcedure.input(z.object({ id: idSchema })).query(async ({ ctx, input }) => {
    const [patient] = await db
      .select()
      .from(dentalPatient)
      .where(and(eq(dentalPatient.companyId, ctx.companyId), eq(dentalPatient.id, input.id)));
    if (!patient) throw new TRPCError({ code: "NOT_FOUND", message: "Patient not found" });

    const [appointments, plans, payments] = await Promise.all([
      db
        .select()
        .from(dentalAppointment)
        .where(
          and(
            eq(dentalAppointment.companyId, ctx.companyId),
            eq(dentalAppointment.patientId, input.id),
          ),
        )
        .orderBy(desc(dentalAppointment.startsAt)),
      db
        .select()
        .from(dentalTreatmentPlan)
        .where(
          and(
            eq(dentalTreatmentPlan.companyId, ctx.companyId),
            eq(dentalTreatmentPlan.patientId, input.id),
          ),
        )
        .orderBy(desc(dentalTreatmentPlan.createdAt)),
      db
        .select()
        .from(dentalPayment)
        .where(
          and(eq(dentalPayment.companyId, ctx.companyId), eq(dentalPayment.patientId, input.id)),
        )
        .orderBy(desc(dentalPayment.paidAt)),
    ]);
    return {
      patient,
      appointments,
      treatmentPlans: plans,
      payments: payments.map((row) => ({ ...row, amount: toAmount(row.amount) })),
    };
  }),

  create: writeProcedure.input(patientFields).mutation(async ({ ctx, input }) => {
    const [existing] = await db
      .select({ id: dentalPatient.id })
      .from(dentalPatient)
      .where(
        and(
          eq(dentalPatient.companyId, ctx.companyId),
          eq(dentalPatient.recordNumber, input.recordNumber),
        ),
      );
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: "Patient record number is already in use" });
    }
    const [created] = await db
      .insert(dentalPatient)
      .values({ companyId: ctx.companyId, ...input })
      .returning();
    return { patient: created };
  }),

  update: writeProcedure
    .input(
      patientFields
        .partial()
        .extend({ id: idSchema })
        .refine(hasChanges, "Provide at least one field to update"),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      await requirePatient(ctx.companyId, id);
      if (changes.recordNumber) {
        const [clash] = await db
          .select({ id: dentalPatient.id })
          .from(dentalPatient)
          .where(
            and(
              eq(dentalPatient.companyId, ctx.companyId),
              eq(dentalPatient.recordNumber, changes.recordNumber),
            ),
          );
        if (clash && clash.id !== id) {
          throw new TRPCError({ code: "CONFLICT", message: "Patient record number is already in use" });
        }
      }
      const [patient] = await db
        .update(dentalPatient)
        .set(changes)
        .where(and(eq(dentalPatient.companyId, ctx.companyId), eq(dentalPatient.id, id)))
        .returning();
      return { patient };
    }),

  archive: writeProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    await requirePatient(ctx.companyId, input.id);
    await db
      .update(dentalPatient)
      .set({ archivedAt: new Date() })
      .where(and(eq(dentalPatient.companyId, ctx.companyId), eq(dentalPatient.id, input.id)));
    return { success: true };
  }),
});

const practitionersRouter = router({
  list: readProcedure
    .input(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }))
    .query(async ({ ctx, input }) => {
      return db
        .select()
        .from(dentalPractitioner)
        .where(
          and(
            eq(dentalPractitioner.companyId, ctx.companyId),
            input.includeInactive ? undefined : eq(dentalPractitioner.active, true),
          ),
        )
        .orderBy(asc(dentalPractitioner.displayName));
    }),

  upsert: settingsProcedure
    .input(practitionerFields.extend({ id: idSchema.optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertUserAssignable(ctx.companyId, input.userId);
      const { id, ...values } = input;
      if (id) {
        await requirePractitioner(ctx.companyId, id);
        const [practitioner] = await db
          .update(dentalPractitioner)
          .set(values)
          .where(and(eq(dentalPractitioner.companyId, ctx.companyId), eq(dentalPractitioner.id, id)))
          .returning();
        return { practitioner };
      }
      const [practitioner] = await db
        .insert(dentalPractitioner)
        .values({ companyId: ctx.companyId, ...values })
        .returning();
      return { practitioner };
    }),
});

const appointmentsRouter = router({
  list: readProcedure
    .input(
      z
        .object({
          from: dateTimeSchema.optional(),
          to: dateTimeSchema.optional(),
          patientId: idSchema.optional(),
          practitionerId: idSchema.optional(),
          status: z.enum(APPOINTMENT_STATUSES).optional(),
          limit: z.number().int().min(1).max(250).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 100, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dentalAppointment.companyId, ctx.companyId),
        input.from ? gte(dentalAppointment.startsAt, input.from) : undefined,
        input.to ? lt(dentalAppointment.startsAt, input.to) : undefined,
        input.patientId ? eq(dentalAppointment.patientId, input.patientId) : undefined,
        input.practitionerId
          ? eq(dentalAppointment.practitionerId, input.practitionerId)
          : undefined,
        input.status ? eq(dentalAppointment.status, input.status) : undefined,
      );
      const [appointments, [total]] = await Promise.all([
        db
          .select({
            appointment: dentalAppointment,
            patientFirstName: dentalPatient.firstName,
            patientLastName: dentalPatient.lastName,
            patientRecordNumber: dentalPatient.recordNumber,
            practitionerName: dentalPractitioner.displayName,
          })
          .from(dentalAppointment)
          .innerJoin(
            dentalPatient,
            and(
              eq(dentalPatient.companyId, dentalAppointment.companyId),
              eq(dentalPatient.id, dentalAppointment.patientId),
            ),
          )
          .innerJoin(
            dentalPractitioner,
            and(
              eq(dentalPractitioner.companyId, dentalAppointment.companyId),
              eq(dentalPractitioner.id, dentalAppointment.practitionerId),
            ),
          )
          .where(where)
          .orderBy(asc(dentalAppointment.startsAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(dentalAppointment).where(where),
      ]);
      return { appointments, total: total?.value ?? 0 };
    }),

  create: writeProcedure.input(appointmentFields).mutation(async ({ ctx, input }) => {
    requireDateOrder(input.startsAt, input.endsAt);
    await Promise.all([
      requirePatient(ctx.companyId, input.patientId),
      requirePractitioner(ctx.companyId, input.practitionerId),
      requirePractitionerAvailable(
        ctx.companyId,
        input.practitionerId,
        input.startsAt,
        input.endsAt,
      ),
    ]);
    const [appointment] = await db
      .insert(dentalAppointment)
      .values({ companyId: ctx.companyId, ...input })
      .returning();
    return { appointment };
  }),

  update: writeProcedure
    .input(
      appointmentFields
        .omit({ patientId: true })
        .partial()
        .extend({ id: idSchema })
        .refine(hasChanges, "Provide at least one field to update"),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const current = await requireAppointment(ctx.companyId, id);
      const startsAt = changes.startsAt ?? current.startsAt;
      const endsAt = changes.endsAt ?? current.endsAt;
      const practitionerId = changes.practitionerId ?? current.practitionerId;
      requireDateOrder(startsAt, endsAt);
      await Promise.all([
        changes.practitionerId
          ? requirePractitioner(ctx.companyId, changes.practitionerId)
          : Promise.resolve(),
        requirePractitionerAvailable(ctx.companyId, practitionerId, startsAt, endsAt, id),
      ]);
      const [appointment] = await db
        .update(dentalAppointment)
        .set(changes)
        .where(and(eq(dentalAppointment.companyId, ctx.companyId), eq(dentalAppointment.id, id)))
        .returning();
      return { appointment };
    }),

  setStatus: writeProcedure
    .input(
      z.object({
        id: idSchema,
        status: z.enum(APPOINTMENT_STATUSES),
        cancellationReason: nullableText(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await requireAppointment(ctx.companyId, input.id);
      if (input.status !== "cancelled" && input.status !== "no_show") {
        await requirePractitionerAvailable(
          ctx.companyId,
          current.practitionerId,
          current.startsAt,
          current.endsAt,
          current.id,
        );
      }
      const [appointment] = await db
        .update(dentalAppointment)
        .set({ status: input.status, cancellationReason: input.cancellationReason })
        .where(
          and(eq(dentalAppointment.companyId, ctx.companyId), eq(dentalAppointment.id, input.id)),
        )
        .returning();
      return { appointment };
    }),
});

const treatmentsRouter = router({
  list: readProcedure
    .input(
      z
        .object({ patientId: idSchema.optional(), status: z.enum(TREATMENT_PLAN_STATUSES).optional() })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const plans = await db
        .select()
        .from(dentalTreatmentPlan)
        .where(
          and(
            eq(dentalTreatmentPlan.companyId, ctx.companyId),
            input.patientId ? eq(dentalTreatmentPlan.patientId, input.patientId) : undefined,
            input.status ? eq(dentalTreatmentPlan.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(dentalTreatmentPlan.createdAt));
      const planIds = plans.map((row) => row.id);
      const items =
        planIds.length === 0
          ? []
          : await db
              .select()
              .from(dentalTreatmentItem)
              .where(
                and(
                  eq(dentalTreatmentItem.companyId, ctx.companyId),
                  inArray(dentalTreatmentItem.treatmentPlanId, planIds),
                ),
              )
              .orderBy(asc(dentalTreatmentItem.createdAt));
      const byPlan = new Map<string, (typeof items)[number][]>();
      for (const item of items) {
        const rows = byPlan.get(item.treatmentPlanId) ?? [];
        rows.push(item);
        byPlan.set(item.treatmentPlanId, rows);
      }
      return {
        treatmentPlans: plans.map((plan) => ({
          ...plan,
          items: (byPlan.get(plan.id) ?? []).map((item) => ({ ...item, fee: toAmount(item.fee) })),
        })),
      };
    }),

  create: writeProcedure.input(planFields).mutation(async ({ ctx, input }) => {
    await requirePatient(ctx.companyId, input.patientId);
    const [treatmentPlan] = await db
      .insert(dentalTreatmentPlan)
      .values({ companyId: ctx.companyId, ...input })
      .returning();
    return { treatmentPlan };
  }),

  update: writeProcedure
    .input(
      planFields
        .omit({ patientId: true })
        .partial()
        .extend({ id: idSchema })
        .refine(hasChanges, "Provide at least one field to update"),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      await requirePlan(ctx.companyId, id);
      const statusDates =
        changes.status === "accepted"
          ? { acceptedAt: new Date() }
          : changes.status === "presented"
            ? { presentedAt: new Date() }
            : changes.status === "completed"
              ? { completedAt: new Date() }
              : {};
      const [treatmentPlan] = await db
        .update(dentalTreatmentPlan)
        .set({ ...changes, ...statusDates })
        .where(and(eq(dentalTreatmentPlan.companyId, ctx.companyId), eq(dentalTreatmentPlan.id, id)))
        .returning();
      return { treatmentPlan };
    }),

  createItem: writeProcedure
    .input(itemFields.extend({ treatmentPlanId: idSchema }))
    .mutation(async ({ ctx, input }) => {
      const plan = await requirePlan(ctx.companyId, input.treatmentPlanId);
      if (input.appointmentId) {
        const appointment = await requireAppointment(ctx.companyId, input.appointmentId);
        if (appointment.patientId !== plan.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Appointment belongs to another patient" });
        }
      }
      const [treatmentItem] = await db
        .insert(dentalTreatmentItem)
        .values({
          companyId: ctx.companyId,
          ...input,
          fee: input.fee.toFixed(2),
          completedAt: input.status === "completed" ? (input.completedAt ?? new Date()) : input.completedAt,
        })
        .returning();
      return { treatmentItem: treatmentItem && { ...treatmentItem, fee: toAmount(treatmentItem.fee) } };
    }),

  updateItem: writeProcedure
    .input(
      itemFields
        .partial()
        .extend({ id: idSchema })
        .refine(hasChanges, "Provide at least one field to update"),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, fee, ...changes } = input;
      const [item] = await db
        .select({ planId: dentalTreatmentItem.treatmentPlanId })
        .from(dentalTreatmentItem)
        .where(
          and(eq(dentalTreatmentItem.companyId, ctx.companyId), eq(dentalTreatmentItem.id, id)),
        );
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Treatment item not found" });
      if (changes.appointmentId) {
        const [plan, appointment] = await Promise.all([
          requirePlan(ctx.companyId, item.planId),
          requireAppointment(ctx.companyId, changes.appointmentId),
        ]);
        if (appointment.patientId !== plan.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Appointment belongs to another patient" });
        }
      }
      const completion =
        changes.status === "completed" && changes.completedAt === undefined
          ? { completedAt: new Date() }
          : changes.status && changes.status !== "completed" && changes.completedAt === undefined
            ? { completedAt: null }
            : {};
      const [treatmentItem] = await db
        .update(dentalTreatmentItem)
        .set({ ...changes, ...completion, ...(fee === undefined ? {} : { fee: fee.toFixed(2) }) })
        .where(and(eq(dentalTreatmentItem.companyId, ctx.companyId), eq(dentalTreatmentItem.id, id)))
        .returning();
      return { treatmentItem: treatmentItem && { ...treatmentItem, fee: toAmount(treatmentItem.fee) } };
    }),

  removeItem: deleteProcedure.input(z.object({ id: idSchema })).mutation(async ({ ctx, input }) => {
    const deleted = await db
      .delete(dentalTreatmentItem)
      .where(
        and(eq(dentalTreatmentItem.companyId, ctx.companyId), eq(dentalTreatmentItem.id, input.id)),
      )
      .returning({ id: dentalTreatmentItem.id });
    if (deleted.length === 0) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Treatment item not found" });
    }
    return { success: true };
  }),
});

const paymentsRouter = router({
  list: readProcedure
    .input(
      z
        .object({
          patientId: idSchema.optional(),
          from: dateTimeSchema.optional(),
          to: dateTimeSchema.optional(),
          limit: z.number().int().min(1).max(250).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .default({ limit: 100, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(dentalPayment.companyId, ctx.companyId),
        input.patientId ? eq(dentalPayment.patientId, input.patientId) : undefined,
        input.from ? gte(dentalPayment.paidAt, input.from) : undefined,
        input.to ? lt(dentalPayment.paidAt, input.to) : undefined,
      );
      const [rows, [total]] = await Promise.all([
        db
          .select({
            payment: dentalPayment,
            patientFirstName: dentalPatient.firstName,
            patientLastName: dentalPatient.lastName,
            patientRecordNumber: dentalPatient.recordNumber,
          })
          .from(dentalPayment)
          .innerJoin(
            dentalPatient,
            and(
              eq(dentalPatient.companyId, dentalPayment.companyId),
              eq(dentalPatient.id, dentalPayment.patientId),
            ),
          )
          .where(where)
          .orderBy(desc(dentalPayment.paidAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(dentalPayment).where(where),
      ]);
      return {
        payments: rows.map((row) => ({
          ...row,
          payment: { ...row.payment, amount: toAmount(row.payment.amount) },
        })),
        total: total?.value ?? 0,
      };
    }),

  create: writeProcedure
    .input(
      z.object({
        patientId: idSchema,
        treatmentPlanId: idSchema.nullable().optional(),
        appointmentId: idSchema.nullable().optional(),
        amount: paymentAmountSchema,
        status: z.enum(["pending", "completed"]).default("completed"),
        method: z.enum(PAYMENT_METHODS),
        reference: nullableText(200),
        notes: nullableText(2000),
        paidAt: dateTimeSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePatient(ctx.companyId, input.patientId);
      if (input.treatmentPlanId) {
        const plan = await requirePlan(ctx.companyId, input.treatmentPlanId);
        if (plan.patientId !== input.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Treatment plan belongs to another patient" });
        }
      }
      if (input.appointmentId) {
        const appointment = await requireAppointment(ctx.companyId, input.appointmentId);
        if (appointment.patientId !== input.patientId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Appointment belongs to another patient" });
        }
      }
      const [payment] = await db
        .insert(dentalPayment)
        .values({
          companyId: ctx.companyId,
          ...input,
          amount: input.amount.toFixed(2),
          paidAt: input.paidAt ?? new Date(),
          receivedById: ctx.session.user.id,
        })
        .returning();
      return { payment: payment && { ...payment, amount: toAmount(payment.amount) } };
    }),
});

export const dentalRouter = router({
  dashboard: dashboardRouter,
  patients: patientsRouter,
  practitioners: practitionersRouter,
  appointments: appointmentsRouter,
  treatments: treatmentsRouter,
  payments: paymentsRouter,
});
