import { db } from "@DashboardV2/db";
import {
  ACTION_PRIORITIES,
  ACTION_TYPES,
  TICKET_STATUSES,
  notification,
  project,
  ticket,
  ticketComment,
  ticketEvent,
  ticketWatcher,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import { roleOf } from "../lib/permissions";
import { assertMember, assertProjectAccess, type ProjectScopeCtx } from "../lib/scope";

/**
 * Tickets, widened into the general construction action they were already
 * being used as.
 *
 * Nothing about an existing ticket changes: same table, same ids, same router
 * name, same permissions. What is added is the vocabulary the site was
 * supplying in the title field anyway — what kind of action this is, how urgent
 * it is, when it is due, and who owns it — plus the discussion, evidence and
 * history that make an action something you can close rather than only record.
 *
 * Kept as `ticket` rather than renamed to `action`. A rename would be a
 * migration of every query, every URL and every cached client for a word, and
 * the word is not the part that was missing.
 */

const statusSchema = z.enum(TICKET_STATUSES);
const contactSchema = z
  .string()
  .trim()
  .min(5, "Contact number is required")
  .max(50)
  .regex(/^[+0-9() .-]+$/, "Use a valid contact number");

const fieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().min(1, "Description is required").max(2000),
  responsibleName: z.string().trim().min(1, "Responsible person is required").max(200),
  responsibleContactNumber: contactSchema,
  type: z.enum(ACTION_TYPES).optional(),
  priority: z.enum(ACTION_PRIORITIES).optional(),
  dueDate: z.iso.date().nullish(),
  /** An account that will be notified. Independent of responsibleName. */
  assigneeId: z.string().min(1).nullish(),
  boqItemId: z.string().min(1).nullish(),
  periodId: z.string().min(1).nullish(),
});

/**
 * Fields whose changes are worth a history row.
 *
 * Deliberately not every column: nobody reconstructing a dispute needs to know
 * that a typo in the description was fixed, and a log that records everything
 * is one nobody reads. These are the ones that change who is responsible, how
 * urgent it is, and whether it is done.
 */
const TRACKED_FIELDS = ["status", "priority", "type", "dueDate", "assigneeId"] as const;

/**
 * Writes an in-app notification.
 *
 * No delivery channel and no background worker: the row is the event, and
 * anything that later wants to send mail reads from here. Silent on failure for
 * the reason recordActivity is — telling somebody their comment failed to save
 * because a notification insert hiccuped would be strictly worse than a missed
 * notification.
 */
async function notify(
  rows: (typeof notification.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(notification).values(rows);
  } catch (error) {
    console.warn("[notify] failed:", error instanceof Error ? error.message : error);
  }
}

/** Everyone who should hear about a change: the assignee and any watchers, minus the actor. */
async function audienceFor(ticketId: string, assigneeId: string | null, actorId: string) {
  const watchers = await db
    .select({ userId: ticketWatcher.userId })
    .from(ticketWatcher)
    .where(eq(ticketWatcher.ticketId, ticketId));

  const ids = new Set(watchers.map((row) => row.userId));
  if (assigneeId) ids.add(assigneeId);
  ids.delete(actorId);
  return [...ids];
}

async function ticketInScope(ctx: ProjectScopeCtx, ticketId: string) {
  const [row] = await db
    .select({ ticket, projectId: project.id, projectCode: project.code, projectName: project.name })
    .from(ticket)
    .innerJoin(project, eq(ticket.projectId, project.id))
    .where(and(eq(ticket.id, ticketId), eq(project.companyId, ctx.companyId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, "Ticket not found");
  }
  return row;
}

export const ticketRouter = router({
  listByProject: companyPermissionProcedure("project:read")
    .input(
      z.object({
        projectId: z.string().min(1),
        search: z.string().trim().max(200).default(""),
        status: statusSchema.optional(),
        type: z.enum(ACTION_TYPES).optional(),
        priority: z.enum(ACTION_PRIORITIES).optional(),
        assigneeId: z.string().min(1).optional(),
        /** Open actions whose due date has passed. */
        overdue: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const filters = [
        eq(ticket.projectId, input.projectId),
        input.status ? eq(ticket.status, input.status) : undefined,
        input.type ? eq(ticket.type, input.type) : undefined,
        input.priority ? eq(ticket.priority, input.priority) : undefined,
        input.assigneeId ? eq(ticket.assigneeId, input.assigneeId) : undefined,
        // Overdue means open *and* past due. A closed action that was late is
        // history, not a thing anybody can act on today.
        input.overdue
          ? and(
              isNotNull(ticket.dueDate),
              sql`${ticket.dueDate} < current_date`,
              sql`${ticket.status} not in ('resolved', 'closed')`,
            )
          : undefined,
        input.search
          ? or(
              ilike(ticket.title, `%${input.search}%`),
              ilike(ticket.description, `%${input.search}%`),
              ilike(ticket.issuerName, `%${input.search}%`),
              ilike(ticket.responsibleName, `%${input.search}%`),
            )
          : undefined,
      ];

      const [rows, counts] = await Promise.all([
        db
          .select()
          .from(ticket)
          .where(and(...filters))
          .orderBy(desc(ticket.createdAt)),
        db
          .select({ status: ticket.status, value: count() })
          .from(ticket)
          .where(eq(ticket.projectId, input.projectId))
          .groupBy(ticket.status),
      ]);

      return {
        tickets: rows,
        counts: Object.fromEntries(
          TICKET_STATUSES.map((status) => [
            status,
            counts.find((row) => row.status === status)?.value ?? 0,
          ]),
        ) as Record<(typeof TICKET_STATUSES)[number], number>,
      };
    }),

  create: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, input.projectId));
      const [created] = await db
        .insert(ticket)
        .values({
          ...input,
          issuerId: ctx.session.user.id,
          issuerName: ctx.session.user.name,
          status: "open",
        })
        .returning({ id: ticket.id });
      if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create ticket" });
      }
      await recordActivity(ctx, {
        action: "created",
        entityType: "ticket",
        entityId: created.id,
        entityLabel: input.title,
        detail: target ? `${target.code} - ${target.name}` : undefined,
      });

      if (input.assigneeId && input.assigneeId !== ctx.session.user.id) {
        await notify([
          {
            userId: input.assigneeId,
            companyId: ctx.companyId,
            projectId: input.projectId,
            kind: "action_assigned",
            entityType: "ticket",
            entityId: created.id,
            entityLabel: input.title,
            actorName: ctx.session.user.name,
            detail: target ? `${target.code} - ${target.name}` : null,
          },
        ]);
      }

      return { id: created.id };
    }),

  update: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const current = await ticketInScope(ctx, id);

      // The history rows are computed before the write, from the row that was
      // read in the same request — comparing afterwards would record no change
      // at all, since by then both sides are the new value.
      const changes = TRACKED_FIELDS.flatMap((field) => {
        const before = current.ticket[field] ?? null;
        const after = (fields as Record<string, unknown>)[field] ?? null;
        if (after === undefined || String(before ?? "") === String(after ?? "")) return [];
        return [
          {
            ticketId: id,
            field,
            fromValue: before === null ? null : String(before),
            toValue: after === null ? null : String(after),
            actorId: ctx.session.user.id,
            actorName: ctx.session.user.name,
          },
        ];
      });

      await runBatch([
        db.update(ticket).set(fields).where(eq(ticket.id, id)),
        ...(changes.length > 0 ? [db.insert(ticketEvent).values(changes)] : []),
      ]);

      await recordActivity(ctx, {
        action: "updated",
        entityType: "ticket",
        entityId: id,
        entityLabel: fields.title,
        detail: `${current.projectCode} - ${current.projectName}`,
      });

      const reassigned =
        fields.assigneeId && fields.assigneeId !== current.ticket.assigneeId;
      if (reassigned && fields.assigneeId !== ctx.session.user.id) {
        await notify([
          {
            userId: fields.assigneeId!,
            companyId: ctx.companyId,
            projectId: current.projectId,
            kind: "action_assigned",
            entityType: "ticket",
            entityId: id,
            entityLabel: fields.title,
            actorName: ctx.session.user.name,
            detail: `${current.projectCode} - ${current.projectName}`,
          },
        ]);
      }

      return { success: true };
    }),

  setStatus: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1), status: statusSchema }))
    .mutation(async ({ ctx, input }) => {
      const current = await ticketInScope(ctx, input.id);
      await db.update(ticket).set({ status: input.status }).where(eq(ticket.id, input.id));
      await recordActivity(ctx, {
        action: "status_changed",
        entityType: "ticket",
        entityId: input.id,
        entityLabel: current.ticket.title,
        detail: input.status,
      });
      return { success: true };
    }),

  /** The discussion on one action, oldest first — it reads as a conversation. */
  comments: companyPermissionProcedure("project:read")
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await ticketInScope(ctx, input.ticketId);
      return db
        .select({
          id: ticketComment.id,
          body: ticketComment.body,
          authorName: ticketComment.authorName,
          createdAt: ticketComment.createdAt,
        })
        .from(ticketComment)
        .where(eq(ticketComment.ticketId, input.ticketId))
        .orderBy(asc(ticketComment.createdAt));
    }),

  addComment: companyPermissionProcedure("project:write")
    .input(z.object({ ticketId: z.string().min(1), body: z.string().trim().min(1).max(4000) }))
    .mutation(async ({ ctx, input }) => {
      // ticketInScope carries the company check and, for role=user, the
      // project-membership check — so a comment cannot be posted onto an action
      // the caller could not read.
      const current = await ticketInScope(ctx, input.ticketId);

      const [created] = await db
        .insert(ticketComment)
        .values({
          ticketId: input.ticketId,
          body: input.body,
          authorId: ctx.session.user.id,
          authorName: ctx.session.user.name,
        })
        .returning({ id: ticketComment.id });

      const audience = await audienceFor(
        input.ticketId,
        current.ticket.assigneeId,
        ctx.session.user.id,
      );
      await notify(
        audience.map((userId) => ({
          userId,
          companyId: ctx.companyId,
          projectId: current.projectId,
          kind: "action_commented" as const,
          entityType: "ticket",
          entityId: input.ticketId,
          entityLabel: current.ticket.title,
          actorName: ctx.session.user.name,
          detail: input.body.slice(0, 200),
        })),
      );

      return { id: created?.id ?? null };
    }),

  /** What has changed on this action, newest first. */
  history: companyPermissionProcedure("project:read")
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await ticketInScope(ctx, input.ticketId);
      return db
        .select()
        .from(ticketEvent)
        .where(eq(ticketEvent.ticketId, input.ticketId))
        .orderBy(desc(ticketEvent.createdAt));
    }),

  /** Follow or unfollow an action without owning it. */
  setWatching: companyPermissionProcedure("project:read")
    .input(z.object({ ticketId: z.string().min(1), watching: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ticketInScope(ctx, input.ticketId);
      if (input.watching) {
        await db
          .insert(ticketWatcher)
          .values({ ticketId: input.ticketId, userId: ctx.session.user.id })
          .onConflictDoNothing();
      } else {
        await db
          .delete(ticketWatcher)
          .where(
            and(
              eq(ticketWatcher.ticketId, input.ticketId),
              eq(ticketWatcher.userId, ctx.session.user.id),
            ),
          );
      }
      return { watching: input.watching };
    }),

  watching: companyPermissionProcedure("project:read")
    .input(z.object({ ticketId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await ticketInScope(ctx, input.ticketId);
      const [row] = await db
        .select({ userId: ticketWatcher.userId })
        .from(ticketWatcher)
        .where(
          and(
            eq(ticketWatcher.ticketId, input.ticketId),
            eq(ticketWatcher.userId, ctx.session.user.id),
          ),
        );
      return { watching: Boolean(row) };
    }),

  /**
   * Closes an action with a stated resolution.
   *
   * Separate from setStatus because closing is the one status change that has
   * to say *how* it was resolved. "Closed" with no resolution is the state a
   * register rots into — six months later nobody can tell a fixed defect from
   * an abandoned one.
   */
  close: companyPermissionProcedure("project:write")
    .input(
      z.object({
        id: z.string().min(1),
        resolution: z.string().trim().min(1, "Say how this was resolved").max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await ticketInScope(ctx, input.id);
      const now = new Date();

      await runBatch([
        db
          .update(ticket)
          .set({ status: "closed", closedAt: now, resolution: input.resolution })
          .where(eq(ticket.id, input.id)),
        db.insert(ticketEvent).values({
          ticketId: input.id,
          field: "status",
          fromValue: current.ticket.status,
          toValue: "closed",
          actorId: ctx.session.user.id,
          actorName: ctx.session.user.name,
        }),
      ]);

      await recordActivity(ctx, {
        action: "status_changed",
        entityType: "ticket",
        entityId: input.id,
        entityLabel: current.ticket.title,
        detail: "closed",
      });

      const audience = await audienceFor(input.id, current.ticket.assigneeId, ctx.session.user.id);
      await notify(
        audience.map((userId) => ({
          userId,
          companyId: ctx.companyId,
          projectId: current.projectId,
          kind: "action_closed" as const,
          entityType: "ticket",
          entityId: input.id,
          entityLabel: current.ticket.title,
          actorName: ctx.session.user.name,
          detail: input.resolution.slice(0, 200),
        })),
      );

      return { success: true };
    }),

  /**
   * Open actions across the portfolio, aged.
   *
   * Buckets rather than a raw count, because "14 open" and "14 open, 9 of them
   * more than a month overdue" call for different responses. Scoped by
   * projectAccessFilter through the join, so a role=user sees only their own
   * projects' actions.
   */
  overdueSummary: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectAccess(ctx, input.projectId);

      const rows = await db
        .select({
          id: ticket.id,
          projectId: ticket.projectId,
          projectCode: project.code,
          projectName: project.name,
          title: ticket.title,
          type: ticket.type,
          priority: ticket.priority,
          status: ticket.status,
          dueDate: ticket.dueDate,
          assigneeName: user.name,
          overdueDays: sql<number | null>`case
            when ${ticket.dueDate} is null then null
            else current_date - ${ticket.dueDate} end`,
        })
        .from(ticket)
        .innerJoin(project, eq(project.id, ticket.projectId))
        .leftJoin(user, eq(user.id, ticket.assigneeId))
        .where(
          and(
            eq(project.companyId, ctx.companyId),
            input.projectId ? eq(ticket.projectId, input.projectId) : undefined,
            sql`${ticket.status} not in ('resolved', 'closed')`,
            roleOf(ctx.session.user) === "user"
              ? sql`exists (
                  select 1 from project_member pm
                  where pm.project_id = ${project.id} and pm.user_id = ${ctx.session.user.id}
                )`
              : undefined,
          ),
        )
        .orderBy(asc(ticket.dueDate));

      const aged = rows.map((row) => ({
        ...row,
        overdueDays: row.overdueDays === null ? null : Number(row.overdueDays),
      }));
      const overdue = aged.filter((row) => (row.overdueDays ?? -1) > 0);

      return {
        open: aged.length,
        overdue: overdue.length,
        critical: aged.filter((row) => row.priority === "critical").length,
        buckets: {
          week: overdue.filter((row) => (row.overdueDays ?? 0) <= 7).length,
          month: overdue.filter((row) => (row.overdueDays ?? 0) > 7 && (row.overdueDays ?? 0) <= 30)
            .length,
          older: overdue.filter((row) => (row.overdueDays ?? 0) > 30).length,
        },
        actions: overdue.slice(0, 20),
      };
    }),

  delete: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const current = await ticketInScope(ctx, input.id);
      await db.delete(ticket).where(eq(ticket.id, input.id));
      await recordActivity(ctx, {
        action: "deleted",
        entityType: "ticket",
        entityId: input.id,
        entityLabel: current.ticket.title,
        detail: `${current.projectCode} - ${current.projectName}`,
      });
      return { success: true };
    }),
});
