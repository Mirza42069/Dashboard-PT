import { relations, sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { company } from "./company";
import { createdAt, id, updatedAt } from "./construction";

export const SUPPORT_REQUEST_STATUSES = ["new", "accepted", "answered", "closed"] as const;
export type SupportRequestStatus = (typeof SUPPORT_REQUEST_STATUSES)[number];

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

export const supportRequestRelations = relations(supportRequest, ({ one }) => ({
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
