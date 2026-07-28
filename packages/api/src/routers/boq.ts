import { db } from "@DashboardV2/db";
import {
  DISTRIBUTION_TYPES,
  PROGRESS_MODES,
  WEIGHT_SOURCES,
  boqItem,
  boqVersion,
  project,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import z from "zod";

import { adminProcedure, protectedProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import {
  WEIGHT_TOLERANCE,
  getVersion,
  leafPredicate,
  leafWeightTotal,
  recalcWeights,
  requireDraft,
  requireDraftForItem,
  serializeItem,
  serializeVersion,
} from "../lib/boq";

const itemSchema = z.object({
  code: z.string().trim().min(1, "Code is required").max(32),
  description: z.string().trim().min(1, "Description is required").max(500),
  unit: z.string().trim().max(20).nullish(),
  quantity: z.number().min(0).nullish(),
  unitRate: z.number().min(0).nullish(),
  weight: z.number().min(0).max(100).nullish(),
  weightSource: z.enum(WEIGHT_SOURCES).default("derived"),
  distribution: z.enum(DISTRIBUTION_TYPES).default("linear"),
  progressMode: z.enum(PROGRESS_MODES).default("by_quantity"),
});

/** Quantities carry four decimals; money helpers round to two. */
function toQuantityString(value: number): string {
  return value.toFixed(4);
}

async function projectLabel(projectId: string) {
  const [row] = await db
    .select({ code: project.code, name: project.name })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return `${row.code} · ${row.name}`;
}

/** Rejects a code that already exists among the item's siblings. */
async function assertCodeFree(input: {
  versionId: string;
  parentId: string | null;
  code: string;
  exceptId?: string;
}) {
  const [clash] = await db
    .select({ id: boqItem.id })
    .from(boqItem)
    .where(
      and(
        eq(boqItem.boqVersionId, input.versionId),
        input.parentId === null ? isNull(boqItem.parentId) : eq(boqItem.parentId, input.parentId),
        eq(boqItem.code, input.code),
        isNull(boqItem.deletedAt),
        input.exceptId ? sql`${boqItem.id} <> ${input.exceptId}` : undefined,
      ),
    );

  if (clash) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Code ${input.code} is already used at this level`,
    });
  }
}

export const boqRouter = router({
  /**
   * The BoQ as the project should be read: the active baseline if there is one,
   * otherwise the newest draft. Items come back flat and the client assembles
   * the tree — it needs the parent/child relationship in hand anyway to work
   * out which lines are leaves.
   */
  overview: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const versions = await db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId))
        .orderBy(desc(boqVersion.versionNo));

      const current = versions.find((row) => row.status === "active") ?? versions[0];
      if (!current) {
        return { version: null, items: [] };
      }

      const items = await db
        .select()
        .from(boqItem)
        .where(and(eq(boqItem.boqVersionId, current.id), isNull(boqItem.deletedAt)))
        .orderBy(asc(boqItem.sortOrder), asc(boqItem.code));

      return { version: serializeVersion(current), items: items.map(serializeItem) };
    }),

  /**
   * Opens the BoQ for editing. Returns the existing draft if one is already
   * open, so the button is safe to press twice.
   */
  getOrCreateDraft: adminProcedure
    .input(z.object({ projectId: z.string().min(1), title: z.string().trim().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      const label = await projectLabel(input.projectId);

      const [existing] = await db
        .select()
        .from(boqVersion)
        .where(and(eq(boqVersion.projectId, input.projectId), eq(boqVersion.status, "draft")))
        .orderBy(desc(boqVersion.versionNo))
        .limit(1);

      if (existing) return { version: serializeVersion(existing) };

      const [highest] = await db
        .select({ value: sql<number | null>`max(${boqVersion.versionNo})` })
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId));

      const versionNo = Number(highest?.value ?? 0) + 1;

      const [created] = await db
        .insert(boqVersion)
        .values({
          projectId: input.projectId,
          versionNo,
          title: input.title ?? `Rev ${versionNo}`,
          status: "draft",
        })
        .returning();

      if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the BoQ" });
      }

      await recordActivity(ctx, {
        action: "created",
        entityType: "boq",
        entityId: created.id,
        entityLabel: label,
        detail: created.title,
      });

      return { version: serializeVersion(created) };
    }),

  /** Redistributes derived weights by value. Draft only. */
  recalcWeights: adminProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await requireDraft(input.versionId);
      await recalcWeights(input.versionId);
      const version = await getVersion(input.versionId);
      return { version: serializeVersion(version), weightTotal: await leafWeightTotal(input.versionId) };
    }),

  /**
   * Baselines the BoQ.
   *
   * Weights are recalculated first, then the activation runs as a single
   * guarded UPDATE: the "do the weights total 100" test lives in the WHERE
   * clause, so there is no window in which a concurrent edit could slip between
   * the check and the write. Zero rows updated means a guard rejected it, and
   * the reason is worked out afterwards purely to write a decent error message.
   */
  activate: adminProcedure
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await requireDraft(input.versionId);
      await recalcWeights(input.versionId);

      const [activated] = await db
        .update(boqVersion)
        .set({
          status: "active",
          baselinedAt: new Date(),
          baselinedById: ctx.session.user.id,
        })
        .where(
          and(
            eq(boqVersion.id, input.versionId),
            eq(boqVersion.status, "draft"),
            sql`not exists (
              select 1 from boq_version other
              where other.project_id = ${boqVersion.projectId} and other.status = 'active'
            )`,
            sql`abs(coalesce((
              select sum(item.weight) from boq_item item
              where item.boq_version_id = ${input.versionId}
                and item.deleted_at is null
                and ${leafPredicate("item")}
            ), 0) - 100) <= ${WEIGHT_TOLERANCE}`,
          ),
        )
        .returning();

      if (!activated) {
        const [otherActive] = await db
          .select({ versionNo: boqVersion.versionNo })
          .from(boqVersion)
          .where(and(eq(boqVersion.projectId, draft.projectId), eq(boqVersion.status, "active")));

        if (otherActive) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Rev ${otherActive.versionNo} is already the active baseline for this project`,
          });
        }

        const total = await leafWeightTotal(input.versionId);
        throw new TRPCError({
          code: "CONFLICT",
          message: `Weights must total 100% before baselining — they currently total ${total.toFixed(2)}%. Add priced items, or check any manually weighted lines.`,
        });
      }

      await recordActivity(ctx, {
        action: "baselined",
        entityType: "boq",
        entityId: activated.id,
        entityLabel: await projectLabel(activated.projectId),
        detail: activated.title,
      });

      return { version: serializeVersion(activated) };
    }),

  /** Adds a section (no parentId) or a line under one. */
  createItem: adminProcedure
    .input(
      itemSchema.extend({
        versionId: z.string().min(1),
        parentId: z.string().min(1).nullish(),
      }),
    )
    .mutation(async ({ input }) => {
      await requireDraft(input.versionId);

      const parentId = input.parentId ?? null;
      if (parentId) {
        const [parent] = await db
          .select({ id: boqItem.id })
          .from(boqItem)
          .where(
            and(
              eq(boqItem.id, parentId),
              eq(boqItem.boqVersionId, input.versionId),
              isNull(boqItem.deletedAt),
            ),
          );
        if (!parent) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Parent section not found" });
        }
      }

      await assertCodeFree({ versionId: input.versionId, parentId, code: input.code });

      // New lines land at the bottom of their group.
      const [last] = await db
        .select({ value: sql<number | null>`max(${boqItem.sortOrder})` })
        .from(boqItem)
        .where(
          and(
            eq(boqItem.boqVersionId, input.versionId),
            parentId === null ? isNull(boqItem.parentId) : eq(boqItem.parentId, parentId),
            isNull(boqItem.deletedAt),
          ),
        );

      const [created] = await db
        .insert(boqItem)
        .values({
          boqVersionId: input.versionId,
          parentId,
          code: input.code,
          description: input.description,
          unit: input.unit ?? null,
          quantity: input.quantity == null ? null : toQuantityString(input.quantity),
          unitRate: input.unitRate == null ? null : toQuantityString(input.unitRate),
          weight: input.weight == null ? "0" : input.weight.toFixed(6),
          weightSource: input.weightSource,
          distribution: input.distribution,
          progressMode: input.progressMode,
          sortOrder: Number(last?.value ?? 0) + 1,
        })
        .returning();

      return { item: created ? serializeItem(created) : null };
    }),

  updateItem: adminProcedure
    .input(itemSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const current = await requireDraftForItem(input.id);
      const { id, code, quantity, unitRate, weight, ...rest } = input;

      if (code && code !== current.code) {
        await assertCodeFree({
          versionId: current.boqVersionId,
          parentId: current.parentId,
          code,
          exceptId: id,
        });
      }

      await db
        .update(boqItem)
        .set({
          ...rest,
          ...(code ? { code } : {}),
          ...(quantity !== undefined
            ? { quantity: quantity === null ? null : toQuantityString(quantity) }
            : {}),
          ...(unitRate !== undefined
            ? { unitRate: unitRate === null ? null : toQuantityString(unitRate) }
            : {}),
          ...(weight !== undefined && weight !== null ? { weight: weight.toFixed(6) } : {}),
        })
        .where(eq(boqItem.id, id));

      const [updated] = await db.select().from(boqItem).where(eq(boqItem.id, id));
      return { item: updated ? serializeItem(updated) : null };
    }),

  /**
   * Soft delete, cascading down the tree in one statement — removing a section
   * has to take its lines with it, or they survive as parentless leaves that
   * still draw weight.
   */
  deleteItem: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await requireDraftForItem(input.id);

      await db.execute(sql`
        update boq_item
        set deleted_at = now(), updated_at = now()
        where deleted_at is null
          and id in (
            with recursive tree as (
              select id from boq_item where id = ${input.id}
              union all
              select child.id from boq_item child join tree on child.parent_id = tree.id
            )
            select id from tree
          )
      `);

      return { success: true };
    }),

  /** Applies a new ordering to a group of siblings in one statement. */
  reorderItems: adminProcedure
    .input(
      z.object({
        versionId: z.string().min(1),
        orderedIds: z.array(z.string().min(1)).min(1).max(500),
      }),
    )
    .mutation(async ({ input }) => {
      await requireDraft(input.versionId);

      const rows = sql.join(
        input.orderedIds.map((id, index) => sql`(${id}::text, ${index}::int)`),
        sql`, `,
      );

      await db.execute(sql`
        update boq_item
        set sort_order = ordering.position, updated_at = now()
        from (values ${rows}) as ordering(id, position)
        where boq_item.id = ordering.id
          and boq_item.boq_version_id = ${input.versionId}
      `);

      return { success: true };
    }),
});
