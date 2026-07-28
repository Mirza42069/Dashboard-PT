import { db } from "@DashboardV2/db";
import { EQUIPMENT_STATUSES, equipment, project } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { assertProjectInScope } from "../lib/scope";

const statusSchema = z.enum(EQUIPMENT_STATUSES);

const upsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().max(100).optional(),
  status: statusSchema.default("available"),
  projectId: z.string().min(1).optional(),
  purchaseDate: z.iso.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const equipmentRouter = router({
  list: companyProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        eq(equipment.companyId, ctx.companyId),
        input.search
          ? or(ilike(equipment.name, `%${input.search}%`), ilike(equipment.code, `%${input.search}%`))
          : undefined,
        input.status ? eq(equipment.status, input.status) : undefined,
      ].filter(Boolean);
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, [total], statusCounts] = await Promise.all([
        db
          .select({
            id: equipment.id,
            code: equipment.code,
            name: equipment.name,
            category: equipment.category,
            status: equipment.status,
            purchaseDate: equipment.purchaseDate,
            projectId: equipment.projectId,
            projectCode: project.code,
            projectName: project.name,
          })
          .from(equipment)
          .leftJoin(project, eq(project.id, equipment.projectId))
          .where(where)
          .orderBy(asc(equipment.code))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(equipment).where(where),
        // Status tiles count the company's fleet, not every tenant's.
        db
          .select({ status: equipment.status, value: count() })
          .from(equipment)
          .where(eq(equipment.companyId, ctx.companyId))
          .groupBy(equipment.status),
      ]);

      return {
        equipment: rows,
        total: total?.value ?? 0,
        counts: Object.fromEntries(
          EQUIPMENT_STATUSES.map((status) => [
            status,
            statusCounts.find((row) => row.status === status)?.value ?? 0,
          ]),
        ) as Record<(typeof EQUIPMENT_STATUSES)[number], number>,
      };
    }),

  create: adminCompanyProcedure.input(upsertSchema).mutation(async ({ ctx, input }) => {
    const code = input.code.toUpperCase();
    const [existing] = await db
      .select({ id: equipment.id })
      .from(equipment)
      .where(and(eq(equipment.code, code), eq(equipment.companyId, ctx.companyId)));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Equipment code ${code} is already in use` });
    }
    if (input.projectId) {
      await assertProjectInScope(ctx.companyId, input.projectId);
    }

    const [created] = await db
      .insert(equipment)
      .values({ ...input, code, companyId: ctx.companyId })
      .returning({ id: equipment.id });

    if (created) {
      await recordActivity(ctx, {
        action: "created",
        entityType: "equipment",
        entityId: created.id,
        entityLabel: `${code} · ${input.name}`,
      });
    }

    return { id: created?.id };
  }),

  update: adminCompanyProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: equipmentId, code, ...rest } = input;

      const [current] = await db
        .select()
        .from(equipment)
        .where(and(eq(equipment.id, equipmentId), eq(equipment.companyId, ctx.companyId)));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found" });
      }
      if (rest.projectId) {
        await assertProjectInScope(ctx.companyId, rest.projectId);
      }
      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: equipment.id })
          .from(equipment)
          .where(
            and(eq(equipment.code, code.toUpperCase()), eq(equipment.companyId, ctx.companyId)),
          );
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `Equipment code ${code} is already in use` });
        }
      }

      // Taking a machine out of service takes it off the site too. Without
      // this, retiring a deployed excavator leaves it listed as still working
      // on a project — and `assign` refuses to deploy retired equipment, so the
      // two procedures would disagree about the same row.
      const goesOffSite = rest.status === "retired" || rest.status === "maintenance";

      await db
        .update(equipment)
        .set({
          ...rest,
          ...(code ? { code: code.toUpperCase() } : {}),
          ...(goesOffSite ? { projectId: null } : {}),
        })
        .where(eq(equipment.id, equipmentId));

      // Only a status change is worth an audit row — retiring a machine is a
      // lifecycle event, renaming it is not.
      if (rest.status && rest.status !== current.status) {
        await recordActivity(ctx, {
          action: "status_changed",
          entityType: "equipment",
          entityId: equipmentId,
          entityLabel: `${current.code} · ${current.name}`,
          detail: rest.status,
        });
      }

      return { success: true };
    }),

  /**
   * Assignment and status move together: something on a site is in use, and
   * something recalled is available again. Keeping these in one procedure stops
   * the two fields drifting out of agreement.
   */
  assign: adminCompanyProcedure
    .input(
      z.object({
        id: z.string().min(1),
        projectId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [current] = await db
        .select()
        .from(equipment)
        .where(and(eq(equipment.id, input.id), eq(equipment.companyId, ctx.companyId)));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found" });
      }
      if (current.status === "maintenance" || current.status === "retired") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Equipment is ${current.status.replace("_", " ")} and cannot be assigned to a site`,
        });
      }

      let targetLabel: string | undefined;
      if (input.projectId) {
        const [target] = await db
          .select({ id: project.id, code: project.code })
          .from(project)
          .where(and(eq(project.id, input.projectId), eq(project.companyId, ctx.companyId)));
        if (!target) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
        }
        targetLabel = target.code;
      }

      await db
        .update(equipment)
        .set({
          projectId: input.projectId,
          status: input.projectId ? "in_use" : "available",
        })
        .where(eq(equipment.id, input.id));

      await recordActivity(ctx, {
        action: "assigned",
        entityType: "equipment",
        entityId: input.id,
        entityLabel: `${current.code} · ${current.name}`,
        detail: targetLabel,
      });

      return { success: true };
    }),

  delete: adminCompanyProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select({ code: equipment.code, name: equipment.name })
        .from(equipment)
        .where(and(eq(equipment.id, input.id), eq(equipment.companyId, ctx.companyId)));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found" });
      }

      await db.delete(equipment).where(eq(equipment.id, input.id));

      await recordActivity(ctx, {
        action: "deleted",
        entityType: "equipment",
        entityId: input.id,
        entityLabel: `${target.code} · ${target.name}`,
      });

      return { success: true };
    }),
});
