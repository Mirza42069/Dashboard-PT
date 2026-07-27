import { db } from "@DashboardV2/db";
import { TASK_PRIORITIES, TASK_STATUSES, project, task, user } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, sql } from "drizzle-orm";
import z from "zod";

import { adminProcedure, protectedProcedure, router } from "../index";

const statusSchema = z.enum(TASK_STATUSES);
const prioritySchema = z.enum(TASK_PRIORITIES);

const upsertSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(2000).optional(),
  status: statusSchema.default("todo"),
  priority: prioritySchema.default("medium"),
  assigneeId: z.string().min(1).optional(),
  dueDate: z.iso.date().optional(),
  isMilestone: z.boolean().default(false),
});

async function assertProjectExists(projectId: string) {
  const [row] = await db.select({ id: project.id }).from(project).where(eq(project.id, projectId));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

export const taskRouter = router({
  listByProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        status: statusSchema.optional(),
      }),
    )
    .query(async ({ input }) => {
      const where = input.status
        ? and(eq(task.projectId, input.projectId), eq(task.status, input.status))
        : eq(task.projectId, input.projectId);

      const rows = await db
        .select({
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
          isMilestone: task.isMilestone,
          assigneeId: task.assigneeId,
          assigneeName: user.name,
          createdAt: task.createdAt,
        })
        .from(task)
        .leftJoin(user, eq(user.id, task.assigneeId))
        .where(where)
        // Milestones first, then earliest due date. Nulls last so undated work
        // doesn't crowd out anything actually scheduled.
        .orderBy(sql`${task.isMilestone} desc`, sql`${task.dueDate} asc nulls last`);

      const counts = await db
        .select({ status: task.status, value: count() })
        .from(task)
        .where(eq(task.projectId, input.projectId))
        .groupBy(task.status);

      return {
        tasks: rows,
        counts: Object.fromEntries(
          TASK_STATUSES.map((status) => [
            status,
            counts.find((row) => row.status === status)?.value ?? 0,
          ]),
        ) as Record<(typeof TASK_STATUSES)[number], number>,
      };
    }),

  /** Assignable users for the task form. */
  assignees: protectedProcedure.query(async () => {
    return db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(eq(user.banned, false))
      .orderBy(asc(user.name));
  }),

  create: adminProcedure.input(upsertSchema).mutation(async ({ input }) => {
    await assertProjectExists(input.projectId);
    const [created] = await db.insert(task).values(input).returning({ id: task.id });
    return { id: created?.id };
  }),

  update: adminProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { id: taskId, ...rest } = input;
      const [current] = await db.select({ id: task.id }).from(task).where(eq(task.id, taskId));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      await db.update(task).set(rest).where(eq(task.id, taskId));
      return { success: true };
    }),

  /**
   * The one write any signed-in user may perform: moving work along. Everything
   * else about a task stays admin-only.
   */
  setStatus: protectedProcedure
    .input(z.object({ id: z.string().min(1), status: statusSchema }))
    .mutation(async ({ input }) => {
      const [current] = await db.select({ id: task.id }).from(task).where(eq(task.id, input.id));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      await db.update(task).set({ status: input.status }).where(eq(task.id, input.id));
      return { success: true };
    }),

  delete: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    await db.delete(task).where(eq(task.id, input.id));
    return { success: true };
  }),
});
