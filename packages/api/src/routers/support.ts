import { db } from "@DashboardV2/db";
import {
  SUPPORT_REQUEST_STATUSES,
  company,
  notification,
  supportRequest,
  user,
  type NotificationKind,
  type SupportRequestStatus,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import z from "zod";

import { companyProcedure, permissionProcedure, protectedProcedure, router } from "../index";
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

const actionConfig: Record<
  SupportAction,
  {
    expected: SupportRequestStatus;
  }
> = {
  accept: { expected: "new" },
  reply: { expected: "accepted" },
  close: { expected: "answered" },
};

async function requestOrThrow(id: string) {
  const [request] = await db.select().from(supportRequest).where(eq(supportRequest.id, id));
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
 */
async function transitionWithNotice(input: {
  id: string;
  action: SupportAction;
  actorId: string;
  actorName: string;
  finalReply?: string;
}) {
  const config = actionConfig[input.action];
  const next = nextSupportStatus(config.expected, input.action);
  if (!next) throw new Error("Invalid support transition configuration");

  const now = new Date();
  const noticeId = crypto.randomUUID();
  const noticeKind = supportNoticeKindForAction(input.action);
  const noticeDetail =
    input.action === "accept" ? sql`NULL` : sql`changed."final_reply"`;
  let actionFields;
  if (input.action === "accept") {
    actionFields = sql`
      "accepted_by_id" = ${input.actorId},
      "accepted_by_name" = ${input.actorName},
      "accepted_at" = ${now}`;
  } else if (input.action === "reply") {
    actionFields = sql`
      "final_reply" = ${input.finalReply ?? null},
      "replied_by_id" = ${input.actorId},
      "replied_by_name" = ${input.actorName},
      "replied_at" = ${now}`;
  } else {
    actionFields = sql`
      "closed_by_id" = ${input.actorId},
      "closed_by_name" = ${input.actorName},
      "closed_at" = ${now}`;
  }

  const result = await db.execute(sql`
    WITH transitioned AS (
      UPDATE "support_request"
      SET
        "status" = ${next},
        "updated_at" = ${now},
        ${actionFields}
      WHERE "id" = ${input.id} AND "status" = ${config.expected}
       RETURNING "id", "requester_id", "company_id", "subject", "final_reply"
    ), superseded AS (
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

  reply: permissionProcedure("support:manage")
    .input(
      idSchema.extend({
        reply: z.string().trim().min(1, "Reply is required").max(10_000),
      }),
    )
    .mutation(({ ctx, input }) =>
      transitionWithNotice({
        id: input.id,
        action: "reply",
        actorId: ctx.session.user.id,
        actorName: ctx.session.user.name,
        finalReply: input.reply,
      }),
    ),

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

  listNotices: companyProcedure.query(async ({ ctx }) =>
    db
      .select({
        id: notification.id,
        kind: notification.kind,
        entityLabel: notification.entityLabel,
        detail: notification.detail,
        actorName: notification.actorName,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          eq(notification.companyId, ctx.companyId),
          isNull(notification.readAt),
          inArray(notification.kind, supportNoticeKinds),
        ),
      )
      .orderBy(desc(notification.createdAt))
      .limit(100),
  ),

  dismissNotice: companyProcedure
    .input(z.object({ noticeId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(notification)
        .where(
          and(
            eq(notification.id, input.noticeId),
            eq(notification.userId, ctx.session.user.id),
            eq(notification.companyId, ctx.companyId),
            inArray(notification.kind, supportNoticeKinds),
          ),
        );
      return { success: true };
    }),
});
