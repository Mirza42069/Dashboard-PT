import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { company } from "./company";
import { createdAt, id, updatedAt } from "./construction";

/**
 * A request is a conversation, and the status says whose turn it is:
 * `accepted` waits on support, `answered` waits on the requester. The pair flips
 * back and forth as messages land, so these four values carry a thread of any
 * length without a fifth being needed.
 */
export const SUPPORT_REQUEST_STATUSES = ["new", "accepted", "answered", "closed"] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

export const SUPPORT_MESSAGE_AUTHORS = ["requester", "support"] as const;
export type SupportMessageAuthor = (typeof SUPPORT_MESSAGE_AUTHORS)[number];

/**
 * Global support inbox. Identity and tenant labels are snapshots so deleting or
 * renaming their source records cannot rewrite the support record.
 */
export const supportRequest = pgTable(
  "support_request",
  {
    id: id(),
    status: text("status").$type<SupportRequestStatus>().default("new").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),

    requesterId: text("requester_id").references(() => user.id, { onDelete: "set null" }),
    requesterName: text("requester_name").notNull(),
    requesterEmail: text("requester_email").notNull(),
    companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
    companyName: text("company_name").notNull(),
    companyCode: text("company_code").notNull(),

    acceptedById: text("accepted_by_id").references(() => user.id, { onDelete: "set null" }),
    acceptedByName: text("accepted_by_name"),
    acceptedAt: timestamp("accepted_at"),

    /**
     * The most recent support reply, denormalised from support_message. Support
     * can reply many times now, so this is no longer "the final word" — it is
     * kept because the notice CTE in routers/support.ts lifts it straight out of
     * the UPDATE's RETURNING to fill a notification body, which spares that path
     * a second round trip.
     */
    finalReply: text("final_reply"),
    repliedById: text("replied_by_id").references(() => user.id, { onDelete: "set null" }),
    repliedByName: text("replied_by_name"),
    repliedAt: timestamp("replied_at"),

    closedById: text("closed_by_id").references(() => user.id, { onDelete: "set null" }),
    closedByName: text("closed_by_name"),
    closedAt: timestamp("closed_at"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "support_request_status_check",
      sql`${table.status} in ('new', 'accepted', 'answered', 'closed')`,
    ),
    index("support_request_created_at_id_idx").on(table.createdAt, table.id),
    index("support_request_status_created_at_id_idx").on(table.status, table.createdAt, table.id),
  ],
);

/**
 * The conversation on a request, one row per message, append-only — the same
 * shape as ticketComment, and for the same reason: a remark keeps the author and
 * the moment it was written, and cannot be quietly edited into a different one.
 *
 * The request's own `message` is the opening and stays on that row; everything
 * said after it lives here.
 */
export const supportMessage = pgTable(
  "support_message",
  {
    id: id(),
    requestId: text("request_id")
      .notNull()
      .references(() => supportRequest.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    /** Snapshot, like every other name on the request. */
    authorName: text("author_name").notNull(),
    /**
     * Which side spoke. Stored rather than derived by comparing authorId to
     * requesterId, because authorId goes null when the account is deleted and a
     * transcript that cannot tell the two sides apart is not a transcript.
     */
    authorSide: text("author_side").$type<SupportMessageAuthor>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "support_message_author_side_check",
      sql`${table.authorSide} in ('requester', 'support')`,
    ),
    // The thread reads oldest-first within one request; this serves that order
    // directly rather than sorting a filtered set.
    index("support_message_request_created_idx").on(table.requestId, table.createdAt),
  ],
);

export const supportMessageRelations = relations(supportMessage, ({ one }) => ({
  request: one(supportRequest, {
    fields: [supportMessage.requestId],
    references: [supportRequest.id],
  }),
  author: one(user, { fields: [supportMessage.authorId], references: [user.id] }),
}));

export const supportRequestRelations = relations(supportRequest, ({ one, many }) => ({
  messages: many(supportMessage),
  requester: one(user, { fields: [supportRequest.requesterId], references: [user.id] }),
  company: one(company, { fields: [supportRequest.companyId], references: [company.id] }),
  acceptedBy: one(user, {
    fields: [supportRequest.acceptedById],
    references: [user.id],
    relationName: "supportAcceptedBy",
  }),
  repliedBy: one(user, {
    fields: [supportRequest.repliedById],
    references: [user.id],
    relationName: "supportRepliedBy",
  }),
  closedBy: one(user, {
    fields: [supportRequest.closedById],
    references: [user.id],
    relationName: "supportClosedBy",
  }),
}));
