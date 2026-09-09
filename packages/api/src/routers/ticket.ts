import { db } from "@DashboardV2/db";
import {
  ACTION_PRIORITIES,
  ACTION_TYPES,
  TICKET_STATUSES,
  boqItem,
  boqVersion,
  project,
  reportingPeriod,
  ticket,
  ticketEvent,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { Effect } from "effect";
import { and, count, desc, eq, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivities, recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import {
  createdAtCursorCondition,
  createdAtCursorSchema,
  exactCursorTimestamp,
} from "../lib/created-at-cursor";
import { catchConflict, attempt, fail, runProcedure } from "../lib/effect";
import { pageWithFocus } from "../lib/focused-page";
import type { MessageDictionary } from "../lib/messages/index";
import { roleOf } from "../lib/permissions";
import {
  assertMember,
  assertNotArchived,
  assertProjectAccess,
  assertProjectWritable,
  assertUserAssignable,
  projectAccessFilter,
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
  /** Assigned account, independent of responsibleName. */
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

async function ticketInScopeForWrite(ctx: ProjectScopeCtx, ticketId: string) {
  const [row] = await db
    .select({
      ticket,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      archivedAt: project.archivedAt,
    })
    .from(ticket)
    .innerJoin(project, eq(ticket.projectId, project.id))
    .where(and(eq(ticket.id, ticketId), eq(project.companyId, ctx.companyId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.ticket.notFound });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, "Ticket not found");
  }
  assertNotArchived(ctx.t, row.archivedAt);
  return row;
}

/**
 * The bulk counterpart of ticketInScopeForWrite.
 *
 * One query for both tenant and membership scope, regardless of how many
 * projects the selection spans. EXISTS keeps one row per ticket.
 *
 * Cross-tenant ids are not rejected, they are simply not matched: the company
 * filter shares its where clause with the id filter, so an id from another
 * company comes back as "not found" without ever confirming it exists.
 */
async function ticketsInScopeForWrite(ctx: ProjectScopeCtx, ticketIds: string[]) {
  const rows = await db
    .select({
      ticket,
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      archivedAt: project.archivedAt,
    })
    .from(ticket)
    .innerJoin(project, eq(ticket.projectId, project.id))
    .where(and(inArray(ticket.id, ticketIds), projectAccessFilter(ctx)));
  if (rows.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.ticket.noneFound });
  }
  if (rows.length !== new Set(ticketIds).size) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.ticket.someNotFound });
  }
  for (const row of rows) assertNotArchived(ctx.t, row.archivedAt);
  return rows;
}

async function assertReferencesInProject(
  t: MessageDictionary,
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
    throw new TRPCError({ code: "BAD_REQUEST", message: t.ticket.lineNotThisProject });
  }
  if (periodId && linkedPeriod.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: t.ticket.periodNotThisProject,
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
    .query(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          yield* attempt(() => assertProjectAccess(ctx, input.projectId));
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
          const focusId = input.focusId && !input.cursor ? input.focusId : undefined;

          const [rows, counts, [total], focusedRows] = yield* Effect.all([
            attempt(() =>
              db
                .select({
                  row: ticket,
                  cursorCreatedAt: exactCursorTimestamp(ticket.createdAt),
                })
                .from(ticket)
                .where(pageWhere)
                .orderBy(desc(ticket.createdAt), desc(ticket.id))
                .limit(input.limit + 1),
            ),
            input.cursor
              ? Effect.succeed([])
              : attempt(() =>
                  db
                    .select({ status: ticket.status, value: count() })
                    .from(ticket)
                    .where(eq(ticket.projectId, input.projectId))
                    .groupBy(ticket.status),
                ),
            input.cursor
              ? Effect.succeed([])
              : attempt(() => db.select({ value: count() }).from(ticket).where(filteredWhere)),
            focusId
              ? attempt(() =>
                  db
                    .select({
                      row: ticket,
                      cursorCreatedAt: exactCursorTimestamp(ticket.createdAt),
                    })
                    .from(ticket)
                    .where(and(filteredWhere, eq(ticket.id, focusId)))
                    .limit(1),
                )
              : Effect.succeed([]),
          ], { concurrency: "unbounded" });

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
      ),
    ),

  create: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ projectId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          yield* attempt(() => assertProjectWritable(ctx, input.projectId));
          yield* attempt(() =>
            assertReferencesInProject(ctx.t, input.projectId, input.boqItemId, input.periodId),
          );
          if (input.assigneeId) {
            const assigneeId = input.assigneeId;
            yield* attempt(() => assertUserAssignable(ctx.t, ctx.companyId, assigneeId));
          }
          const [target] = yield* attempt(() =>
            db
              .select({ code: project.code, name: project.name })
              .from(project)
              .where(eq(project.id, input.projectId)),
          );
          const createdId = crypto.randomUUID();
          yield* attempt(() =>
            runBatch([
              db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`),
              db.insert(ticket).values({
                id: createdId,
                ...input,
                issuerId: ctx.session.user.id,
                issuerName: ctx.session.user.name,
                status: "open",
              }),
            ]),
          );
          yield* attempt(() =>
            recordActivity(ctx, {
              action: "created",
              entityType: "ticket",
              entityId: createdId,
              entityLabel: input.title,
              detail: target ? `${target.code} - ${target.name}` : undefined,
            }),
          );

          return { id: createdId };
        }),
      ),
    ),

  update: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const { id, ...fields } = input;
          const current = yield* attempt(() => ticketInScopeForWrite(ctx, id));
          yield* attempt(() =>
            assertReferencesInProject(ctx.t, current.projectId, fields.boqItemId, fields.periodId),
          );
          if (fields.assigneeId && fields.assigneeId !== current.ticket.assigneeId) {
            const assigneeId = fields.assigneeId;
            yield* attempt(() => assertUserAssignable(ctx.t, ctx.companyId, assigneeId));
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

          yield* attempt(() =>
            runBatch([
              db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${current.projectId}, 0))`),
              db.update(ticket).set(fields).where(eq(ticket.id, id)),
              ...(changes.length > 0 ? [db.insert(ticketEvent).values(changes)] : []),
            ]),
          );

          yield* attempt(() =>
            recordActivity(ctx, {
              action: "updated",
              entityType: "ticket",
              entityId: id,
              entityLabel: fields.title,
              detail: `${current.projectCode} - ${current.projectName}`,
            }),
          );

          return { success: true };
        }),
      ),
    ),

  setStatus: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1), status: statusSchema }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const current = yield* attempt(() => ticketInScopeForWrite(ctx, input.id));

          if (input.status === "closed") {
            return yield* fail("BAD_REQUEST", ctx.t.ticket.closeWithResolution);
          }
          if (current.ticket.status === input.status) return { success: true };

          const reopening = current.ticket.status === "closed";
          const now = new Date();
          const assignments = [sql`status = ${input.status}`, sql`updated_at = ${now}`];
          if (reopening) assignments.push(sql`closed_at = null`, sql`resolution = null`);

          const changed = yield* catchConflict(attempt(() =>
            db.execute<{ id: string }>(sql`
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
            `),
          ), ctx.t.ticket.someChangedRefresh);
          if (changed.rows.length === 0) {
            return yield* fail("CONFLICT", ctx.t.ticket.changedRefresh);
          }
          yield* attempt(() =>
            recordActivity(ctx, {
              action: "status_changed",
              entityType: "ticket",
              entityId: input.id,
              entityLabel: current.ticket.title,
              detail: input.status,
            }),
          );
          return { success: true };
        }),
      ),
    ),

  setStatusMany: companyPermissionProcedure("project:write")
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        status: statusSchema.exclude(["closed"]),
      }),
    )
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const rows = yield* attempt(() => ticketsInScopeForWrite(ctx, input.ids));
          const changes = rows
            .filter((row) => row.ticket.status !== input.status)
            .map((row) => ({
              id: row.ticket.id,
              fromStatus: row.ticket.status,
              eventId: crypto.randomUUID(),
            }));
          if (changes.length === 0) return { success: true, count: 0 };

          const changed = yield* catchConflict(attempt(() =>
            db.execute<{ id: string }>(sql`
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
            `),
          ), ctx.t.ticket.someChangedRefresh);
          if (changed.rows.length !== changes.length) {
            return yield* fail("CONFLICT", ctx.t.ticket.someChangedRefresh);
          }
          yield* attempt(() =>
            recordActivities(
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
            ),
          );
          return { success: true, count: changes.length };
        }),
      ),
    ),

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
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const current = yield* attempt(() => ticketInScopeForWrite(ctx, input.id));
          if (current.ticket.status === "closed") {
            return yield* fail("CONFLICT", ctx.t.ticket.alreadyClosed);
          }
          const now = new Date();

          const changed = yield* attempt(() =>
            db.execute<{ id: string }>(sql`
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
            `),
          );
          if (changed.rows.length !== 2) {
            return yield* fail("CONFLICT", ctx.t.ticket.changedRefresh);
          }

          yield* attempt(() =>
            recordActivity(ctx, {
              action: "status_changed",
              entityType: "ticket",
              entityId: input.id,
              entityLabel: current.ticket.title,
              detail: "closed",
            }),
          );

          return { success: true };
        }),
      ),
    ),

  /**
   * Deletes the selected actions.
   *
   * One statement, not a loop of single deletes from the client: a partial
   * failure halfway through a selection leaves the table in a state nobody can
   * reason about, and the row that failed is the one the user cannot see.
   */
  deleteMany: companyPermissionProcedure("project:write")
    .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const rows = yield* attempt(() => ticketsInScopeForWrite(ctx, input.ids));
          const ids = rows.map((row) => row.ticket.id);

          yield* attempt(() => db.delete(ticket).where(inArray(ticket.id, ids)));

          yield* attempt(() =>
            recordActivities(
              ctx,
              rows.map((row) => ({
                action: "deleted",
                entityType: "ticket" as const,
                entityId: row.ticket.id,
                entityLabel: row.ticket.title,
                detail: `${row.projectCode} - ${row.projectName}`,
              })),
            ),
          );

          return { success: true, count: ids.length };
        }),
      ),
    ),
});
