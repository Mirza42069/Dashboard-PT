import { db } from "@DashboardV2/db";
import {
  PERIOD_TYPES,
  PROJECT_STATUSES,
  equipment,
  expense,
  project,
  task,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, sum } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { type BoqMetrics, boqMetricsByProject } from "../lib/boq-metrics";
import { percentOf, toAmount, toNumericString } from "../lib/money";
import { assertUserAssignable } from "../lib/scope";

const statusSchema = z.enum(PROJECT_STATUSES);

const upsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
  name: z.string().trim().min(1, "Name is required").max(200),
  client: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  status: statusSchema.default("planning"),
  // Plain calendar dates end to end — see the note in the schema file.
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  contractValue: z.number().min(0).default(0),
  budget: z.number().min(0).default(0),
  progress: z.number().int().min(0).max(100).default(0),
  periodType: z.enum(PERIOD_TYPES).default("weekly"),
  scheduleStart: z.iso.date().optional(),
  managerId: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
});

/** Total recorded spend per project, keyed by project id. */
async function spendByProject(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({ projectId: expense.projectId, total: sum(expense.amount) })
    .from(expense)
    .where(inArray(expense.projectId, projectIds))
    .groupBy(expense.projectId);

  return new Map(rows.map((row) => [row.projectId, toAmount(row.total)]));
}

/** Open (not done) task counts per project. */
async function openTasksByProject(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({ projectId: task.projectId, open: count() })
    .from(task)
    .where(and(inArray(task.projectId, projectIds), sql`${task.status} <> 'done'`))
    .groupBy(task.projectId);

  return new Map(rows.map((row) => [row.projectId, row.open]));
}

/**
 * `boq` is present only for projects with an active baseline. Everything else
 * keeps reporting the progress figure the PM typed in, so adding the BoQ module
 * changed nothing for projects that do not use it.
 */
function decorate(
  row: typeof project.$inferSelect,
  spent: number,
  openTasks: number,
  boq?: BoqMetrics,
) {
  const budget = toAmount(row.budget);
  return {
    ...row,
    contractValue: toAmount(row.contractValue),
    budget,
    spent,
    remaining: budget - spent,
    budgetUsedPercent: percentOf(spent, budget),
    isOverBudget: budget > 0 && spent > budget,
    openTasks,
    /** The figure to show. Read this rather than `progress`. */
    progressPercent: boq ? boq.progress : row.progress,
    progressSource: boq ? ("boq" as const) : ("manual" as const),
    plannedPercent: boq?.planned ?? null,
    /** actual − planned. Negative is behind. Null when nothing is reported. */
    deviation: boq?.deviation ?? null,
    dataDate: boq?.dataDate ?? null,
  };
}

export const projectRouter = router({
  list: companyProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(project.companyId, ctx.companyId),
        input.search
          ? or(
              ilike(project.name, `%${input.search}%`),
              ilike(project.code, `%${input.search}%`),
              ilike(project.client, `%${input.search}%`),
            )
          : undefined,
        input.status ? eq(project.status, input.status) : undefined,
      ].filter(Boolean);
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(project)
          .where(where)
          .orderBy(desc(project.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(project).where(where),
      ]);

      const ids = rows.map((row) => row.id);
      const [spend, openTasks, boq] = await Promise.all([
        spendByProject(ids),
        openTasksByProject(ids),
        boqMetricsByProject(ids),
      ]);

      return {
        projects: rows.map((row) =>
          decorate(row, spend.get(row.id) ?? 0, openTasks.get(row.id) ?? 0, boq.get(row.id)),
        ),
        total: total?.value ?? 0,
      };
    }),

  /** Lightweight list for the project pickers on other screens. */
  options: companyProcedure.query(async ({ ctx }) => {
    return db
      .select({ id: project.id, code: project.code, name: project.name, status: project.status })
      .from(project)
      .where(eq(project.companyId, ctx.companyId))
      .orderBy(asc(project.code));
  }),

  get: companyProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(project)
      .where(and(eq(project.id, input.id), eq(project.companyId, ctx.companyId)));
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    const [spend, openTasks, boq, manager, spendByCategory] = await Promise.all([
      spendByProject([row.id]),
      openTasksByProject([row.id]),
      boqMetricsByProject([row.id]),
      row.managerId
        ? db
            .select({ id: user.id, name: user.name, email: user.email })
            .from(user)
            .where(eq(user.id, row.managerId))
        : Promise.resolve([]),
      db
        .select({ category: expense.category, total: sum(expense.amount) })
        .from(expense)
        .where(eq(expense.projectId, row.id))
        .groupBy(expense.category),
    ]);

    return {
      ...decorate(row, spend.get(row.id) ?? 0, openTasks.get(row.id) ?? 0, boq.get(row.id)),
      manager: manager[0] ?? null,
      spendByCategory: spendByCategory.map((entry) => ({
        category: entry.category,
        total: toAmount(entry.total),
      })),
    };
  }),

  /**
   * Projects running behind their baseline, worst first. Only projects with an
   * active BoQ and at least one reading can be behind — everything else has no
   * plan to be measured against and is left out rather than shown as on track.
   */
  behindSchedule: companyProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({ id: project.id, code: project.code, name: project.name, client: project.client })
        .from(project)
        .where(eq(project.companyId, ctx.companyId));

      const metrics = await boqMetricsByProject(rows.map((row) => row.id));

      return rows
        .flatMap((row) => {
          const boq = metrics.get(row.id);
          if (!boq || boq.deviation === null || boq.deviation >= 0) return [];
          return [{ ...row, ...boq, deviation: boq.deviation }];
        })
        .sort((a, b) => a.deviation - b.deviation)
        .slice(0, input.limit);
    }),

  /** Everything the dashboard needs, in one round trip. */
  summary: companyProcedure.query(async ({ ctx }) => {
    const inCompany = eq(project.companyId, ctx.companyId);
    // expense and task carry no company of their own, so both join through
    // project rather than filtering directly.
    const [statusRows, [totals], [spentRow], [openTaskRow]] = await Promise.all([
      db
        .select({ status: project.status, value: count() })
        .from(project)
        .where(inCompany)
        .groupBy(project.status),
      db
        .select({
          contractValue: sum(project.contractValue),
          budget: sum(project.budget),
        })
        .from(project)
        .where(inCompany),
      db
        .select({ total: sum(expense.amount) })
        .from(expense)
        .innerJoin(project, eq(expense.projectId, project.id))
        .where(inCompany),
      db
        .select({ value: count() })
        .from(task)
        .innerJoin(project, eq(task.projectId, project.id))
        .where(and(inCompany, sql`${task.status} <> 'done'`)),
    ]);

    const byStatus = Object.fromEntries(
      PROJECT_STATUSES.map((status) => [
        status,
        statusRows.find((row) => row.status === status)?.value ?? 0,
      ]),
    ) as Record<(typeof PROJECT_STATUSES)[number], number>;

    const budget = toAmount(totals?.budget);
    const spent = toAmount(spentRow?.total);

    return {
      projects: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
      },
      portfolioValue: toAmount(totals?.contractValue),
      budget,
      spent,
      budgetUsedPercent: percentOf(spent, budget),
      openTasks: openTaskRow?.value ?? 0,
    };
  }),

  create: adminCompanyProcedure.input(upsertSchema).mutation(async ({ ctx, input }) => {
    const code = input.code.toUpperCase();

    // Codes are unique per company, so the clash check is scoped too.
    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.code, code), eq(project.companyId, ctx.companyId)));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Project code ${code} is already in use` });
    }
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
    }
    if (input.managerId) {
      await assertUserAssignable(ctx.companyId, input.managerId);
    }

    const [created] = await db
      .insert(project)
      .values({
        ...input,
        code,
        companyId: ctx.companyId,
        contractValue: toNumericString(input.contractValue),
        budget: toNumericString(input.budget),
      })
      .returning({ id: project.id });

    if (created) {
      await recordActivity(ctx, {
        action: "created",
        entityType: "project",
        entityId: created.id,
        entityLabel: `${code} · ${input.name}`,
      });
    }

    return { id: created?.id };
  }),

  update: adminCompanyProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: projectId, contractValue, budget, code, ...rest } = input;

      const [current] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.companyId, ctx.companyId)));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const startDate = rest.startDate ?? current.startDate;
      const endDate = rest.endDate ?? current.endDate;
      if (startDate && endDate && endDate < startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
      }
      if (rest.managerId) {
        await assertUserAssignable(ctx.companyId, rest.managerId);
      }

      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: project.id })
          .from(project)
          .where(
            and(eq(project.code, code.toUpperCase()), eq(project.companyId, ctx.companyId)),
          );
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `Project code ${code} is already in use` });
        }
      }

      await db
        .update(project)
        .set({
          ...rest,
          ...(code ? { code: code.toUpperCase() } : {}),
          ...(contractValue !== undefined ? { contractValue: toNumericString(contractValue) } : {}),
          ...(budget !== undefined ? { budget: toNumericString(budget) } : {}),
        })
        .where(eq(project.id, projectId));

      return { success: true };
    }),

  /**
   * Tasks and expenses cascade, but that is a lot of history to lose by
   * accident, so deleting a project with either requires an explicit confirm.
   * Equipment is only unassigned, never deleted — it outlives the site.
   */
  delete: adminCompanyProcedure
    .input(z.object({ id: z.string().min(1), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      // Read the label before deleting — after the row is gone there is nothing
      // left to name it with, and that is the row the audit trail most needs.
      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(and(eq(project.id, input.id), eq(project.companyId, ctx.companyId)));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [[expenses], [tasks]] = await Promise.all([
        db.select({ value: count() }).from(expense).where(eq(expense.projectId, input.id)),
        db.select({ value: count() }).from(task).where(eq(task.projectId, input.id)),
      ]);

      const expenseCount = expenses?.value ?? 0;
      const taskCount = tasks?.value ?? 0;

      if (!input.force && (expenseCount > 0 || taskCount > 0)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This project has ${taskCount} task(s) and ${expenseCount} expense(s), which will be deleted with it. Confirm to continue.`,
        });
      }

      await db
        .update(equipment)
        .set({ projectId: null, status: "available" })
        .where(eq(equipment.projectId, input.id));

      await db.delete(project).where(eq(project.id, input.id));

      await recordActivity(ctx, {
        action: "deleted",
        entityType: "project",
        entityId: input.id,
        entityLabel: `${target.code} · ${target.name}`,
      });

      return { success: true, deletedTasks: taskCount, deletedExpenses: expenseCount };
    }),
});
