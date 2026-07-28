import { db } from "@DashboardV2/db";
import { MOVEMENT_TYPES, material, materialMovement, project, user } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { roundAmount, toAmount, toNumericString } from "../lib/money";
import { assertProjectInScope } from "../lib/scope";

/**
 * Signed stock expression. `out` subtracts, `in` and `adjustment` add — so a
 * correction downwards is recorded as an `out`, and `adjustment` is reserved
 * for stock-take gains. Stock is always computed from this ledger, never stored,
 * because the Neon HTTP driver cannot wrap the insert and a counter update in
 * one transaction.
 */
const signedQuantity = sql<string>`coalesce(sum(case when ${materialMovement.type} = 'out' then -${materialMovement.quantity} else ${materialMovement.quantity} end), 0)`;

/** Current stock for one material. */
async function stockOf(materialId: string): Promise<number> {
  const [row] = await db
    .select({ stock: signedQuantity })
    .from(materialMovement)
    .where(eq(materialMovement.materialId, materialId));
  return toAmount(row?.stock);
}

const upsertSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, "SKU is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
  name: z.string().trim().min(1, "Name is required").max(200),
  unit: z.string().trim().min(1, "Unit is required").max(20),
  reorderLevel: z.number().min(0).default(0),
  unitCost: z.number().min(0).default(0),
});

export const materialRouter = router({
  list: companyProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        lowStockOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(material.companyId, ctx.companyId),
        input.search
          ? or(ilike(material.name, `%${input.search}%`), ilike(material.sku, `%${input.search}%`))
          : undefined,
      );

      // Low stock compares against the summed ledger, so it is an aggregate
      // condition and belongs in HAVING. It used to be a .filter() on the
      // mapped rows, which ran after the SQL LIMIT — so low-stock items past
      // the first page were unreachable and `total` counted the unfiltered set.
      const isLowStock = sql`${material.reorderLevel} > 0 and ${signedQuantity} <= ${material.reorderLevel}`;
      const having = input.lowStockOnly ? isLowStock : undefined;

      const matching = db
        .select({ id: material.id })
        .from(material)
        .leftJoin(materialMovement, eq(materialMovement.materialId, material.id))
        .where(where)
        .groupBy(material.id)
        .having(having)
        .as("matching");

      // Every low-stock row for the current search, not just the current page —
      // the filter toggle carries this as a badge, and a per-page number there
      // would understate the problem as soon as paging exists.
      const lowStock = db
        .select({ id: material.id })
        .from(material)
        .leftJoin(materialMovement, eq(materialMovement.materialId, material.id))
        .where(where)
        .groupBy(material.id)
        .having(isLowStock)
        .as("low_stock");

      const [rows, [total], [lowStockTotal]] = await Promise.all([
        db
          .select({
            id: material.id,
            sku: material.sku,
            name: material.name,
            unit: material.unit,
            reorderLevel: material.reorderLevel,
            unitCost: material.unitCost,
            stock: signedQuantity,
          })
          .from(material)
          .leftJoin(materialMovement, eq(materialMovement.materialId, material.id))
          .where(where)
          .groupBy(material.id)
          .having(having)
          .orderBy(asc(material.name))
          .limit(input.limit)
          .offset(input.offset),
        // Counts the same grouped/filtered set, so the footer agrees with what
        // paging can actually reach.
        db.select({ value: count() }).from(matching),
        db.select({ value: count() }).from(lowStock),
      ]);

      const materials = rows.map((row) => {
        const stock = toAmount(row.stock);
        const reorderLevel = toAmount(row.reorderLevel);
        const unitCost = toAmount(row.unitCost);
        return {
          id: row.id,
          sku: row.sku,
          name: row.name,
          unit: row.unit,
          stock,
          reorderLevel,
          unitCost,
          stockValue: roundAmount(stock * unitCost),
          // Still returned — the table renders a badge from it — but no longer
          // the thing that does the filtering.
          isLowStock: reorderLevel > 0 && stock <= reorderLevel,
        };
      });

      return {
        materials,
        total: total?.value ?? 0,
        lowStockTotal: lowStockTotal?.value ?? 0,
      };
    }),

  listMovements: companyProcedure
    .input(
      z.object({
        materialId: z.string().min(1).optional(),
        projectId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      // The material join below is inner, so scoping the material also scopes
      // the movements — a movement cannot outlive its material.
      const filters = [
        eq(material.companyId, ctx.companyId),
        input.materialId ? eq(materialMovement.materialId, input.materialId) : undefined,
        input.projectId ? eq(materialMovement.projectId, input.projectId) : undefined,
      ].filter(Boolean);

      return db
        .select({
          id: materialMovement.id,
          type: materialMovement.type,
          quantity: materialMovement.quantity,
          occurredOn: materialMovement.occurredOn,
          note: materialMovement.note,
          materialName: material.name,
          materialUnit: material.unit,
          projectCode: project.code,
          recordedByName: user.name,
        })
        .from(materialMovement)
        .innerJoin(material, eq(material.id, materialMovement.materialId))
        .leftJoin(project, eq(project.id, materialMovement.projectId))
        .leftJoin(user, eq(user.id, materialMovement.recordedById))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(desc(materialMovement.occurredOn), desc(materialMovement.createdAt))
        .limit(input.limit);
    }),

  create: adminCompanyProcedure.input(upsertSchema).mutation(async ({ ctx, input }) => {
    const sku = input.sku.toUpperCase();
    const [existing] = await db
      .select({ id: material.id })
      .from(material)
      .where(and(eq(material.sku, sku), eq(material.companyId, ctx.companyId)));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `SKU ${sku} is already in use` });
    }

    const [created] = await db
      .insert(material)
      .values({
        ...input,
        sku,
        companyId: ctx.companyId,
        reorderLevel: toNumericString(input.reorderLevel),
        unitCost: toNumericString(input.unitCost),
      })
      .returning({ id: material.id });

    if (created) {
      await recordActivity(ctx, {
        action: "created",
        entityType: "material",
        entityId: created.id,
        entityLabel: `${sku} · ${input.name}`,
      });
    }

    return { id: created?.id };
  }),

  update: adminCompanyProcedure
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: materialId, sku, reorderLevel, unitCost, ...rest } = input;

      const [current] = await db
        .select()
        .from(material)
        .where(and(eq(material.id, materialId), eq(material.companyId, ctx.companyId)));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
      }
      if (sku && sku.toUpperCase() !== current.sku) {
        const [clash] = await db
          .select({ id: material.id })
          .from(material)
          .where(
            and(eq(material.sku, sku.toUpperCase()), eq(material.companyId, ctx.companyId)),
          );
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `SKU ${sku} is already in use` });
        }
      }

      await db
        .update(material)
        .set({
          ...rest,
          ...(sku ? { sku: sku.toUpperCase() } : {}),
          ...(reorderLevel !== undefined ? { reorderLevel: toNumericString(reorderLevel) } : {}),
          ...(unitCost !== undefined ? { unitCost: toNumericString(unitCost) } : {}),
        })
        .where(eq(material.id, materialId));

      return { success: true };
    }),

  recordMovement: adminCompanyProcedure
    .input(
      z.object({
        materialId: z.string().min(1),
        projectId: z.string().min(1).optional(),
        type: z.enum(MOVEMENT_TYPES),
        quantity: z.number().positive("Quantity must be greater than zero"),
        occurredOn: z.iso.date(),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select({ id: material.id, unit: material.unit, sku: material.sku, name: material.name })
        .from(material)
        .where(and(eq(material.id, input.materialId), eq(material.companyId, ctx.companyId)));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
      }
      // A movement may name a project, which must belong to the same company —
      // otherwise it would surface one tenant's site code in the other's ledger.
      if (input.projectId) {
        await assertProjectInScope(ctx.companyId, input.projectId);
      }

      // Issuing more than is on hand is a data-entry error, not a negative
      // balance. Checked before the insert; the ledger stays the source of truth.
      if (input.type === "out") {
        const stock = await stockOf(input.materialId);
        if (input.quantity > stock) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Only ${stock} ${target.unit} on hand — cannot issue ${input.quantity}`,
          });
        }
      }

      await db.insert(materialMovement).values({
        materialId: input.materialId,
        projectId: input.projectId,
        type: input.type,
        quantity: toNumericString(input.quantity),
        occurredOn: input.occurredOn,
        note: input.note,
        recordedById: ctx.session.user.id,
      });

      await recordActivity(ctx, {
        action: "movement_recorded",
        entityType: "material",
        entityId: input.materialId,
        entityLabel: `${target.sku} · ${target.name}`,
        detail: `${input.type} ${input.quantity} ${target.unit}`,
      });

      return { success: true, stock: await stockOf(input.materialId) };
    }),

  /**
   * `force` mirrors project.delete. Without it this was unusable: stock exists
   * only because movements exist, so refusing on any movement history made every
   * material that had ever been stocked permanently undeletable — and nothing
   * deletes a movement, so there was no way out. The material_movement FK is
   * ON DELETE cascade, so the ledger goes with the row.
   */
  delete: adminCompanyProcedure
    .input(z.object({ id: z.string().min(1), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      // Read the label before deleting — afterwards there is nothing left to
      // name it with, and that is the row the audit trail most needs.
      const [target] = await db
        .select({ sku: material.sku, name: material.name })
        .from(material)
        .where(and(eq(material.id, input.id), eq(material.companyId, ctx.companyId)));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
      }

      const [movements] = await db
        .select({ value: count() })
        .from(materialMovement)
        .where(eq(materialMovement.materialId, input.id));
      const movementCount = movements?.value ?? 0;

      if (!input.force && movementCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This material has ${movementCount} movement(s), which will be deleted with it. Confirm to continue.`,
        });
      }

      await db.delete(material).where(eq(material.id, input.id));

      await recordActivity(ctx, {
        action: "deleted",
        entityType: "material",
        entityId: input.id,
        entityLabel: `${target.sku} · ${target.name}`,
      });

      return { success: true, deletedMovements: movementCount };
    }),

  /**
   * Bulk counterpart of delete. Scoping lives in the same where clause as the
   * id filter, so an id from another tenant is simply not matched rather than
   * reported as forbidden — which would confirm the row exists.
   */
  deleteMany: adminCompanyProcedure
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const targets = await db
        .select({ id: material.id, sku: material.sku, name: material.name })
        .from(material)
        .where(and(inArray(material.id, input.ids), eq(material.companyId, ctx.companyId)));
      if (targets.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No materials found" });
      }

      const ids = targets.map((row) => row.id);

      const [movements] = await db
        .select({ value: count() })
        .from(materialMovement)
        .where(inArray(materialMovement.materialId, ids));
      const movementCount = movements?.value ?? 0;

      if (!input.force && movementCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `These materials have ${movementCount} movement(s), which will be deleted with them. Confirm to continue.`,
        });
      }

      await db.delete(material).where(inArray(material.id, ids));

      // One entry per material, matching the per-row semantics of the feed.
      for (const target of targets) {
        await recordActivity(ctx, {
          action: "deleted",
          entityType: "material",
          entityId: target.id,
          entityLabel: `${target.sku} · ${target.name}`,
        });
      }

      return { success: true, count: targets.length, deletedMovements: movementCount };
    }),
});
