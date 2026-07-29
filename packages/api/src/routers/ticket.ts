import { db } from "@DashboardV2/db";
import { TICKET_STATUSES, project, ticket } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { roleOf } from "../lib/permissions";
import { assertMember, assertProjectAccess, type ProjectScopeCtx } from "../lib/scope";

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
});

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
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const filters = [
        eq(ticket.projectId, input.projectId),
        input.status ? eq(ticket.status, input.status) : undefined,
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
        detail: target ? `${target.code} · ${target.name}` : undefined,
      });
      return { id: created.id };
    }),

  update: companyPermissionProcedure("project:write")
    .input(fieldsSchema.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const current = await ticketInScope(ctx, id);
      await db.update(ticket).set(fields).where(eq(ticket.id, id));
      await recordActivity(ctx, {
        action: "updated",
        entityType: "ticket",
        entityId: id,
        entityLabel: fields.title,
        detail: `${current.projectCode} · ${current.projectName}`,
      });
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
        detail: `${current.projectCode} · ${current.projectName}`,
      });
      return { success: true };
    }),
});
