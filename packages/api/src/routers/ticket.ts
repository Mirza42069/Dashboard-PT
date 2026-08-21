import { db } from "@DashboardV2/db";
import {
  ACTION_PRIORITIES,
  ACTION_TYPES,
  TICKET_STATUSES,
  boqItem,
  boqVersion,
  notification,
  project,
  reportingPeriod,
  ticket,
  ticketComment,
  ticketEvent,
  ticketWatcher,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivities, recordActivity } from "../lib/activity";
import { databaseErrorIncludes } from "../lib/database-error";
import { runBatch } from "../lib/batch";
import {
  createdAtCursorCondition,
  createdAtCursorSchema,
  exactCursorTimestamp,
} from "../lib/created-at-cursor";
import { pageWithFocus } from "../lib/focused-page";
import { roleOf } from "../lib/permissions";
import {
  assertMember,
  assertProjectAccess,
  assertUserAssignable,
  type ProjectScopeCtx,
} from "../lib/scope";

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
const focusedCreatedAtCursorSchema = createdAtCursorSchema.extend({
  inclusive: z.literal(true).optional(),
});
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

/**
 * The bulk counterpart of ticketInScope.
 *
 * One query for the scope check rather than one per id, and one assertMember
 * per distinct project rather than per ticket — a selection of thirty tickets
 * on one project should not be thirty membership round trips.
 *
 * Cross-tenant ids are not rejected, they are simply not matched: the company
 * filter shares its where clause with the id filter, so an id from another
 * company comes back as "not found" without ever confirming it exists.
 */
async function ticketsInScope(ctx: ProjectScopeCtx, ticketIds: string[]) {
  const rows = await db
    .select({ ticket, projectId: project.id, projectCode: project.code, projectName: project.name })
    .from(ticket)
    .innerJoin(project, eq(ticket.projectId, project.id))
    .where(and(inArray(ticket.id, ticketIds), eq(project.companyId, ctx.companyId)));
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No tickets found" });
  }
  if (rows.length !== new Set(ticketIds).size) {
    throw new TRPCError({ code: "NOT_FOUND", message: "One or more tickets were not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    for (const projectId of new Set(rows.map((row) => row.projectId))) {
      await assertMember(projectId, ctx.session.user.id, "Ticket not found");
    }
  }
  return rows;
}

async function assertReferencesInProject(
  projectId: string,
  boqItemId: string | null | undefined,
  periodId: string | null | undefined,
) {
  const [linkedItem, linkedPeriod] = await Promise.all([
    boqItemId
      ? db
          .select({ id: boqItem.id })
          .from(boqItem)
          .innerJoin(boqVersion, eq(boqItem.boqVersionId, boqVersion.id))
          .where(and(eq(boqItem.id, boqItemId), eq(boqVersion.projectId, projectId)))
          .limit(1)
      : Promise.resolve([]),
    periodId
      ? db
          .select({ id: reportingPeriod.id })
          .from(reportingPeriod)
          .where(and(eq(reportingPeriod.id, periodId), eq(reportingPeriod.projectId, projectId)))
          .limit(1)
      : Promise.resolve([]),
  ]);

  if (boqItemId && linkedItem.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The BOQ item is not part of this project." });
  }
  if (periodId && linkedPeriod.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The reporting period is not part of this project.",
    });
  }
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
        limit: z.number().int().min(1).max(100).default(25),
        cursor: focusedCreatedAtCursorSchema.optional(),
        focusId: z.string().min(1).optional(),
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
      const filteredWhere = and(...filters);

      const pageWhere = and(
        filteredWhere,
        input.focusId ? ne(ticket.id, input.focusId) : undefined,
        input.cursor
          ? createdAtCursorCondition(
              ticket.createdAt,
              ticket.id,
              input.cursor,
              input.cursor.inclusive,
            )
          : undefined,
      );

      const [rows, counts, [total], focusedRows] = await Promise.all([
        db
          .select({
            row: ticket,
            cursorCreatedAt: exactCursorTimestamp(ticket.createdAt),
          })
          .from(ticket)
          .where(pageWhere)
          .orderBy(desc(ticket.createdAt), desc(ticket.id))
          .limit(input.limit + 1),
        input.cursor
          ? Promise.resolve([])
          : db
              .select({ status: ticket.status, value: count() })
              .from(ticket)
              .where(eq(ticket.projectId, input.projectId))
              .groupBy(ticket.status),
        input.cursor
          ? Promise.resolve([])
          : db.select({ value: count() }).from(ticket).where(filteredWhere),
        input.focusId && !input.cursor
          ? db
              .select({
                row: ticket,
                cursorCreatedAt: exactCursorTimestamp(ticket.createdAt),
              })
              .from(ticket)
              .where(and(filteredWhere, eq(ticket.id, input.focusId)))
              .limit(1)
          : Promise.resolve([]),
      ]);

      const page = pageWithFocus(rows, focusedRows[0], input.limit);

      return {
        tickets: page.items.map(({ row }) => row),
        total: total?.value ?? null,
        counts: input.cursor
          ? null
          : (Object.fromEntries(
              TICKET_STATUSES.map((status) => [
                status,
                counts.find((row) => row.status === status)?.value ?? 0,
              ]),
            ) as Record<(typeof TICKET_STATUSES)[number], number>),
        nextCursor: page.next
          ? {
              createdAt: page.next.row.cursorCreatedAt,
              id: page.next.row.row.id,
              ...(page.next.inclusive ? { inclusive: true as const } : {}),
            }
          : null,
      };
    }),

  create: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      await assertReferencesInProject(input.projectId, input.boqItemId, input.periodId);
      if (input.assigneeId) await assertUserAssignable(ctx.companyId, input.assigneeId);
      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, input.projectId));
      const createdId = crypto.randomUUID();
      await runBatch([
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`),
        db.insert(ticket).values({
          id: createdId,
          ...input,
          issuerId: ctx.session.user.id,
          issuerName: ctx.session.user.name,
          status: "open",
        }),
      ]);
      await recordActivity(ctx, {
        action: "created",
        entityType: "ticket",
        entityId: createdId,
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
            entityId: createdId,
            entityLabel: input.title,
            actorName: ctx.session.user.name,
            detail: target ? `${target.code} - ${target.name}` : null,
          },
        ]);
      }

      return { id: createdId };
    }),

  update: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const current = await ticketInScope(ctx, id);
      await assertReferencesInProject(current.projectId, fields.boqItemId, fields.periodId);
      if (fields.assigneeId && fields.assigneeId !== current.ticket.assigneeId) {
        await assertUserAssignable(ctx.companyId, fields.assigneeId);
      }

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
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${current.projectId}, 0))`),
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

      if (input.status === "closed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Close the action with a resolution instead of changing its status directly.",
        });
      }
      if (current.ticket.status === input.status) return { success: true };

      const reopening = current.ticket.status === "closed";
      const now = new Date();
      const assignments = [sql`status = ${input.status}`, sql`updated_at = ${now}`];
      if (reopening) assignments.push(sql`closed_at = null`, sql`resolution = null`);

      let changed;
      try {
        changed = await db.execute<{ id: string }>(sql`
        with changed as (
          update ticket
          set ${sql.join(assignments, sql`, `)}
          where id = ${input.id} and status = ${current.ticket.status}
          returning id
        )
        insert into ticket_event
          (id, ticket_id, field, from_value, to_value, actor_id, actor_name)
        select
          ${crypto.randomUUID()}, id, 'status', ${current.ticket.status}, ${input.status},
          ${ctx.session.user.id}, ${ctx.session.user.name}
        from changed
        returning id
        `);
      } catch (error) {
        if (databaseErrorIncludes(error, "division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "One or more actions changed while you were viewing them. Refresh and try again.",
          });
        }
        throw error;
      }
      if (changed.rows.length === 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This action changed while you were viewing it. Refresh and try again.",
        });
      }
      await recordActivity(ctx, {
        action: "status_changed",
        entityType: "ticket",
        entityId: input.id,
        entityLabel: current.ticket.title,
        detail: input.status,
      });
      return { success: true };
    }),

  setStatusMany: companyPermissionProcedure("project:write")
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        status: statusSchema.exclude(["closed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ticketsInScope(ctx, input.ids);
      const changes = rows
        .filter((row) => row.ticket.status !== input.status)
        .map((row) => ({
          id: row.ticket.id,
          fromStatus: row.ticket.status,
          eventId: crypto.randomUUID(),
        }));
      if (changes.length === 0) return { success: true, count: 0 };

      let changed;
      try {
        changed = await db.execute<{ id: string }>(sql`
        with input_rows as (
          select * from jsonb_to_recordset(${JSON.stringify(changes)}::jsonb) as value(
            id text, "fromStatus" text, "eventId" text
          )
        ), changed as (
          update ticket
          set status = ${input.status},
              closed_at = case when input_rows."fromStatus" = 'closed' then null else ticket.closed_at end,
              resolution = case when input_rows."fromStatus" = 'closed' then null else ticket.resolution end,
              updated_at = now()
          from input_rows
          where ticket.id = input_rows.id and ticket.status = input_rows."fromStatus"
          returning ticket.id
        ), guarded as (
          select 1 / case when (select count(*) from changed) = ${changes.length}
            then 1 else 0 end as valid
        )
        insert into ticket_event
          (id, ticket_id, field, from_value, to_value, actor_id, actor_name)
        select
          input_rows."eventId", input_rows.id, 'status', input_rows."fromStatus", ${input.status},
          ${ctx.session.user.id}, ${ctx.session.user.name}
        from input_rows
        join changed on changed.id = input_rows.id
        cross join guarded
        where guarded.valid = 1
        returning ticket_id as id
        `);
      } catch (error) {
        if (databaseErrorIncludes(error, "division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "One or more actions changed while you were viewing them. Refresh and try again.",
          });
        }
        throw error;
      }
      if (changed.rows.length !== changes.length) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "One or more actions changed while you were viewing them. Refresh and try again.",
        });
      }
      await recordActivities(
        ctx,
        rows
          .filter((row) => row.ticket.status !== input.status)
          .map((row) => ({
            action: "status_changed" as const,
            entityType: "ticket" as const,
            entityId: row.ticket.id,
            entityLabel: row.ticket.title,
            detail: input.status,
          })),
      );
      return { success: true, count: changes.length };
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
      if (current.ticket.status === "closed") {
        throw new TRPCError({ code: "CONFLICT", message: "This action is already closed." });
      }
      const now = new Date();

      const changed = await db.execute<{ id: string }>(sql`
        with changed as (
          update ticket
          set status = 'closed', closed_at = ${now}, resolution = ${input.resolution},
              updated_at = ${now}
          where id = ${input.id} and status = ${current.ticket.status}
          returning id
        )
        insert into ticket_event
          (id, ticket_id, field, from_value, to_value, actor_id, actor_name)
        select
          event.id, changed.id, event.field, event.from_value, event.to_value,
          ${ctx.session.user.id}, ${ctx.session.user.name}
        from changed cross join (values
          (${crypto.randomUUID()}, 'status', ${current.ticket.status}, 'closed'),
          (${crypto.randomUUID()}, 'resolution', null, ${input.resolution})
        ) as event(id, field, from_value, to_value)
        returning id
      `);
      if (changed.rows.length !== 2) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This action changed while you were viewing it. Refresh and try again.",
        });
      }

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
        .leftJoin(user, and(eq(user.id, ticket.assigneeId), eq(user.companyId, ctx.companyId)))
        .where(
          and(
            eq(project.companyId, ctx.companyId),
            sql`${project.status} not in ('completed', 'cancelled')`,
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

  /**
   * Bulk counterpart of delete.
   *
   * One statement, not a loop of single deletes from the client: a partial
   * failure halfway through a selection leaves the table in a state nobody can
   * reason about, and the row that failed is the one the user cannot see.
   */
  deleteMany: companyPermissionProcedure("project:write")
    .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ticketsInScope(ctx, input.ids);
      const ids = rows.map((row) => row.ticket.id);

      await db.delete(ticket).where(inArray(ticket.id, ids));

      await recordActivities(
        ctx,
        rows.map((row) => ({
          action: "deleted",
          entityType: "ticket" as const,
          entityId: row.ticket.id,
          entityLabel: row.ticket.title,
          detail: `${row.projectCode} - ${row.projectName}`,
        })),
      );

      return { success: true, count: ids.length };
    }),
});
