import { db } from "@DashboardV2/db";
import { equipment, expense, PROJECT_STATUSES, project, task, user } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, sum } from "drizzle-orm";
import z from "zod";

import { adminProcedure, protectedProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { percentOf, toAmount, toNumericString } from "../lib/money";

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

function decorate(row: typeof project.$inferSelect, spent: number, openTasks: number) {
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
  };
}

export const projectRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const filters = [
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
      const [spend, openTasks] = await Promise.all([
        spendByProject(ids),
        openTasksByProject(ids),
      ]);

      return {
        projects: rows.map((row) =>
          decorate(row, spend.get(row.id) ?? 0, openTasks.get(row.id) ?? 0),
        ),
        total: total?.value ?? 0,
      };
    }),

  /** Lightweight list for the project pickers on other screens. */
  options: protectedProcedure.query(async () => {
    return db
      .select({ id: project.id, code: project.code, name: project.name, status: project.status })
      .from(project)
      .orderBy(asc(project.code));
  }),

  get: protectedProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const [row] = await db.select().from(project).where(eq(project.id, input.id));
    if (!row) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }

    const [spend, openTasks, manager, spendByCategory] = await Promise.all([
      spendByProject([row.id]),
      openTasksByProject([row.id]),
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
      ...decorate(row, spend.get(row.id) ?? 0, openTasks.get(row.id) ?? 0),
      manager: manager[0] ?? null,
      spendByCategory: spendByCategory.map((entry) => ({
        category: entry.category,
        total: toAmount(entry.total),
      })),
    };
  }),

  /** Everything the dashboard needs, in one round trip. */
  summary: protectedProcedure.query(async () => {
    const [statusRows, [totals], [spentRow], [openTaskRow]] = await Promise.all([
      db.select({ status: project.status, value: count() }).from(project).groupBy(project.status),
      db
        .select({
          contractValue: sum(project.contractValue),
          budget: sum(project.budget),
        })
        .from(project),
      db.select({ total: sum(expense.amount) }).from(expense),
      db
        .select({ value: count() })
        .from(task)
        .where(sql`${task.status} <> 'done'`),
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

  create: adminProcedure.input(upsertSchema).mutation(async ({ ctx, input }) => {
    const code = input.code.toUpperCase();

    const [existing] = await db.select({ id: project.id }).from(project).where(eq(project.code, code));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Project code ${code} is already in use` });
    }
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
    }

    const [created] = await db
      .insert(project)
      .values({
        ...input,
        code,
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

  update: adminProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { id: projectId, contractValue, budget, code, ...rest } = input;

      const [current] = await db.select().from(project).where(eq(project.id, projectId));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const startDate = rest.startDate ?? current.startDate;
      const endDate = rest.endDate ?? current.endDate;
      if (startDate && endDate && endDate < startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
      }

      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: project.id })
          .from(project)
          .where(eq(project.code, code.toUpperCase()));
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
  delete: adminProcedure
    .input(z.object({ id: z.string().min(1), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      // Read the label before deleting — after the row is gone there is nothing
      // left to name it with, and that is the row the audit trail most needs.
      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, input.id));
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
