import { db } from "@DashboardV2/db";
import {
  SUPPORT_REQUEST_STATUSES,
  company,
  notification,
  supportMessage,
  supportRequest,
  user,
  type NotificationKind,
  type SupportMessageAuthor,
  type SupportRequestStatus,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import z from "zod";

import { permissionProcedure, protectedProcedure, router } from "../index";
import {
  createdAtCursorCondition,
  createdAtCursorSchema,
  exactCursorTimestamp,
} from "../lib/created-at-cursor";
import { roleOf } from "../lib/permissions";
import {
  SUPPORT_NOTICE_KINDS,
  nextSupportStatus,
  supportNoticeKindForAction,
  type SupportAction,
} from "../lib/support-policy";

const supportStatusSchema = z.enum(SUPPORT_REQUEST_STATUSES);
const idSchema = z.object({ id: z.string().min(1) });
const supportNoticeKinds = SUPPORT_NOTICE_KINDS satisfies readonly NotificationKind[];

/**
 * The states each action may be applied from. Where it lands is not listed here
 * — that is nextSupportStatus's answer, and duplicating it would let the two
 * drift. `userReply` is the reason this matters: adding to an untriaged request
 * leaves it `new`, while adding to a live one claims the turn.
 */
const actionSources: Record<
  SupportAction,
  readonly [SupportRequestStatus, ...SupportRequestStatus[]]
> = {
  accept: ["new"],
  reply: ["accepted", "answered"],
  userReply: ["new", "accepted", "answered"],
  close: ["accepted", "answered"],
};

/**
 * The transcript of one request, oldest first — it reads as a conversation.
 * The request's own `message` is the opening and is not in here; callers render
 * it from the request row.
 */
function messagesFor(requestId: string) {
  return db
    .select({
      id: supportMessage.id,
      body: supportMessage.body,
      authorName: supportMessage.authorName,
      authorSide: supportMessage.authorSide,
      createdAt: supportMessage.createdAt,
    })
    .from(supportMessage)
    .where(eq(supportMessage.requestId, requestId))
    .orderBy(asc(supportMessage.createdAt));
}

/**
 * Appends to the transcript, then moves the turn.
 *
 * The message lands first on purpose: the transition is the conditional write
 * that can lose a race, so if it throws, the caller sees the conflict rather
 * than a status that moved without anything being said. A stray message with no
 * transition is recoverable — the reverse is not.
 */
async function appendMessage(input: {
  requestId: string;
  action: Extract<SupportAction, "reply" | "userReply">;
  body: string;
  authorId: string;
  authorName: string;
  authorSide: SupportMessageAuthor;
}) {
  await db.insert(supportMessage).values({
    requestId: input.requestId,
    body: input.body,
    authorId: input.authorId,
    authorName: input.authorName,
    authorSide: input.authorSide,
  });

  return transitionWithNotice({
    id: input.requestId,
    action: input.action,
    actorId: input.authorId,
    actorName: input.authorName,
    // Mirrored onto the request so the notice CTE can lift it for the
    // notification body without a second round trip.
    finalReply: input.action === "reply" ? input.body : undefined,
  });
}

async function requestOrThrow(id: string) {
  const [request] = await db.select().from(supportRequest).where(eq(supportRequest.id, id));
  if (!request) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Support request not found" });
  }
  return request;
}

/**
 * A request the caller filed themselves.
 *
 * NOT_FOUND rather than FORBIDDEN when it belongs to somebody else: a requester
 * has no business learning that another company's request id exists, and the two
 * cases are indistinguishable from outside on purpose.
 */
async function ownThreadOrThrow(id: string, userId: string) {
  const [request] = await db
    .select()
    .from(supportRequest)
    .where(and(eq(supportRequest.id, id), eq(supportRequest.requesterId, userId)));
  if (!request) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Support request not found" });
  }
  return request;
}

async function throwTransitionError(id: string, action: SupportAction): Promise<never> {
  const request = await requestOrThrow(id);
  if (nextSupportStatus(request.status, action) === null) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Cannot ${action} a ${request.status} support request`,
    });
  }
  // The row changed after the failed conditional write and before this read.
  throw new TRPCError({ code: "CONFLICT", message: "Support request changed; refresh and try again" });
}

/**
 * Changes state, removes the previous unread notice for this request, and
 * creates the replacement notice in one SQL statement. The CTE keeps racing
 * actions from producing duplicate or stale notices.
 *
 * A `userReply` carries no notice — the notices are addressed to the requester,
 * and there the requester is the one speaking — so that path runs the same
 * conditional UPDATE with the two notice CTEs left off.
 */
async function transitionWithNotice(input: {
  id: string;
  action: SupportAction;
  actorId: string;
  actorName: string;
  finalReply?: string;
}) {
  const sources = actionSources[input.action];
  const landings = sources.map((from) => {
    const to = nextSupportStatus(from, input.action);
    if (!to) throw new Error("Invalid support transition configuration");
    return { from, to };
  });

  const now = new Date();
  const noticeId = crypto.randomUUID();
  const noticeKind = supportNoticeKindForAction(input.action);
  const noticeDetail =
    input.action === "accept" ? sql`NULL` : sql`changed."final_reply"`;
  const expected = sql.join(
    sources.map((status) => sql`${status}`),
    sql`, `,
  );
  // A CASE rather than a literal, because where an action lands can depend on
  // where it started — a requester's message keeps an untriaged request `new`
  // but claims the turn on a live one. Reading the old status inside the same
  // UPDATE keeps that decision on the row's own value, so it stays correct under
  // a concurrent write instead of trusting a status we read a moment ago.
  const nextStatus = sql.join(
    [
      sql`CASE "status"`,
      ...landings.map(({ from, to }) => sql`WHEN ${from} THEN ${to}`),
      sql`END`,
    ],
    sql` `,
  );
  // Every branch opens with a comma: the SET list above it always has entries,
  // and `userReply` contributes no columns of its own beyond the status and
  // updated_at that every transition writes.
  let actionFields;
  if (input.action === "accept") {
    actionFields = sql`,
      "accepted_by_id" = ${input.actorId},
      "accepted_by_name" = ${input.actorName},
      "accepted_at" = ${now}`;
  } else if (input.action === "reply") {
    actionFields = sql`,
      "final_reply" = ${input.finalReply ?? null},
      "replied_by_id" = ${input.actorId},
      "replied_by_name" = ${input.actorName},
      "replied_at" = ${now}`;
  } else if (input.action === "close") {
    actionFields = sql`,
      "closed_by_id" = ${input.actorId},
      "closed_by_name" = ${input.actorName},
      "closed_at" = ${now}`;
  } else {
    actionFields = sql``;
  }

  const transitioned = sql`
    WITH transitioned AS (
      UPDATE "support_request"
      SET
        "status" = ${nextStatus},
        "updated_at" = ${now}
        ${actionFields}
      WHERE "id" = ${input.id} AND "status" IN (${expected})
       RETURNING "id", "requester_id", "company_id", "subject", "final_reply"
    )`;

  if (noticeKind === null) {
    const quiet = await db.execute(sql`${transitioned} SELECT "id" FROM transitioned`);
    if (quiet.rows.length === 0) await throwTransitionError(input.id, input.action);
    return requestOrThrow(input.id);
  }

  const result = await db.execute(sql`
    ${transitioned}, superseded AS (
      DELETE FROM "notification" AS old_notice
      USING transitioned AS changed
      WHERE old_notice."user_id" = changed."requester_id"
        AND old_notice."entity_type" = 'support_request'
        AND old_notice."entity_id" = changed."id"
        AND old_notice."read_at" IS NULL
        AND old_notice."kind" IN (
          ${supportNoticeKinds[0]}, ${supportNoticeKinds[1]}, ${supportNoticeKinds[2]}
        )
      RETURNING old_notice."id"
    ), notice AS (
      INSERT INTO "notification" (
        "id", "user_id", "company_id", "kind", "entity_type", "entity_id",
        "entity_label", "detail", "actor_name", "created_at"
      )
      SELECT
        ${noticeId}, changed."requester_id",
        coalesce(current_requester."company_id", changed."company_id"), ${noticeKind},
        'support_request', changed."id", changed."subject", ${noticeDetail},
        ${input.actorName}, ${now}
      FROM transitioned AS changed
      LEFT JOIN "user" AS current_requester
        ON current_requester."id" = changed."requester_id"
      CROSS JOIN (SELECT count(*) FROM superseded) AS deleted
      WHERE changed."requester_id" IS NOT NULL
        AND coalesce(current_requester."company_id", changed."company_id") IS NOT NULL
    )
    SELECT "id" FROM transitioned
  `);

  if (result.rows.length === 0) await throwTransitionError(input.id, input.action);
  return requestOrThrow(input.id);
}

export const supportRouter = router({
  submit: protectedProcedure
    .input(
      z.object({
        subject: z.string().trim().min(1, "Subject is required").max(200),
        message: z.string().trim().min(1, "Message is required").max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (roleOf(ctx.session.user) === "super_admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "System accounts cannot submit support requests",
        });
      }

      const companyId = await ctx.getCompanyId();
      const [identity] = await db
        .select({
          requesterId: user.id,
          requesterName: user.name,
          requesterEmail: user.email,
          companyId: company.id,
          companyName: company.name,
          companyCode: company.code,
        })
        .from(user)
        .innerJoin(company, eq(company.id, user.companyId))
        .where(
          and(
            eq(user.id, ctx.session.user.id),
            eq(company.id, companyId),
            inArray(user.role, ["admin", "user"]),
          ),
        );
      if (!identity) {
        throw new TRPCError({ code: "FORBIDDEN", message: "A company account is required" });
      }

      const [created] = await db
        .insert(supportRequest)
        .values({ ...identity, subject: input.subject, message: input.message })
        .returning({
          id: supportRequest.id,
          status: supportRequest.status,
          createdAt: supportRequest.createdAt,
        });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return created;
    }),

  list: permissionProcedure("support:manage")
    .input(
      z.object({
        status: supportStatusSchema.optional(),
        search: z.string().trim().max(200).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: createdAtCursorSchema.optional(),
      }),
    )
    .query(async ({ input }) => {
      const baseFilter = and(
        input.status ? eq(supportRequest.status, input.status) : undefined,
        input.search
          ? or(
              ilike(supportRequest.subject, `%${input.search}%`),
              ilike(supportRequest.requesterName, `%${input.search}%`),
              ilike(supportRequest.requesterEmail, `%${input.search}%`),
              ilike(supportRequest.companyName, `%${input.search}%`),
              ilike(supportRequest.companyCode, `%${input.search}%`),
            )
          : undefined,
      );
      const cursorFilter =
        input.cursor
          ? createdAtCursorCondition(supportRequest.createdAt, supportRequest.id, input.cursor)
          : undefined;
      const rows = await db
        .select({
          row: supportRequest,
          cursorCreatedAt: exactCursorTimestamp(supportRequest.createdAt),
        })
        .from(supportRequest)
        .where(
          and(baseFilter, cursorFilter),
        )
        .orderBy(desc(supportRequest.createdAt), desc(supportRequest.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const requests = page.map(({ row }) => row);
      const last = page.at(-1);
      return {
        requests,
        nextCursor:
          hasMore && last ? { createdAt: last.cursorCreatedAt, id: last.row.id } : null,
      };
    }),

  get: permissionProcedure("support:manage")
    .input(idSchema)
    .query(({ input }) => requestOrThrow(input.id)),

  accept: permissionProcedure("support:manage")
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      transitionWithNotice({
        id: input.id,
        action: "accept",
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
      }),
    ),

  /** Repeatable: support answers as many times as the conversation needs. */
  reply: permissionProcedure("support:manage")
    .input(
      idSchema.extend({
        reply: z.string().trim().min(1, "Reply is required").max(10_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      appendMessage({
        requestId: input.id,
        action: "reply",
        body: input.reply,
        authorId: ctx.session.user.id,
        authorName: ctx.session.user.name,
        authorSide: "support",
      }),
    ),

  /** The transcript behind the inbox's detail sheet. */
  thread: permissionProcedure("support:manage")
    .input(idSchema)
    .query(({ input }) => messagesFor(input.id)),

  close: permissionProcedure("support:manage")
    .input(idSchema)
    .mutation(({ ctx, input }) =>
      transitionWithNotice({
        id: input.id,
        action: "close",
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
      }),
    ),

  /**
   * The requester's own threads. Scoped by requesterId rather than by company —
   * a support request belongs to the person who filed it, and moving companies
   * should not hand their conversation to a stranger or take it away from them.
   */
  myRequests: protectedProcedure.query(async ({ ctx }) => {
    const unreadByRequest = db
      .select({
        entityId: notification.entityId,
        unread: count().as("unread"),
      })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          eq(notification.entityType, "support_request"),
          isNull(notification.readAt),
          inArray(notification.kind, supportNoticeKinds),
        ),
      )
      .groupBy(notification.entityId)
      .as("unread_by_request");

    return db
      .select({
        id: supportRequest.id,
        subject: supportRequest.subject,
        status: supportRequest.status,
        createdAt: supportRequest.createdAt,
        updatedAt: supportRequest.updatedAt,
        unread: sql<number>`coalesce(${unreadByRequest.unread}, 0)`.mapWith(Number),
      })
      .from(supportRequest)
      .leftJoin(unreadByRequest, eq(unreadByRequest.entityId, supportRequest.id))
      .where(eq(supportRequest.requesterId, ctx.session.user.id))
      .orderBy(desc(supportRequest.updatedAt), desc(supportRequest.id))
      .limit(100);
  }),

  /** One of the requester's own threads, opening message included. */
  myThread: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const request = await ownThreadOrThrow(input.id, ctx.session.user.id);
    return {
      request: {
        id: request.id,
        subject: request.subject,
        status: request.status,
        message: request.message,
        requesterName: request.requesterName,
        createdAt: request.createdAt,
      },
      messages: await messagesFor(request.id),
    };
  }),

  /** The requester's side of the conversation. */
  postMessage: protectedProcedure
    .input(
      idSchema.extend({
        body: z.string().trim().min(1, "Message is required").max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await ownThreadOrThrow(input.id, ctx.session.user.id);
      if (request.status === "closed") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This conversation is closed",
        });
      }
      await appendMessage({
        requestId: request.id,
        action: "userReply",
        body: input.body,
        authorId: ctx.session.user.id,
        authorName: ctx.session.user.name,
        authorSide: "requester",
      });
      return { success: true };
    }),

  /**
   * Clears the badge for one thread. Marks read rather than deleting, so the
   * notification stays a record of what was sent — the old dismiss-to-delete
   * behaviour threw that away.
   */
  markThreadRead: protectedProcedure.input(idSchema).mutation(async ({ ctx, input }) => {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          eq(notification.entityType, "support_request"),
          eq(notification.entityId, input.id),
          isNull(notification.readAt),
          inArray(notification.kind, supportNoticeKinds),
        ),
      );
    return { success: true };
  }),

  /** Drives the badge on the Support nav item. */
  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ value: count() })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          eq(notification.entityType, "support_request"),
          isNull(notification.readAt),
          inArray(notification.kind, supportNoticeKinds),
        ),
      );
    return { unread: row?.value ?? 0 };
  }),
});
