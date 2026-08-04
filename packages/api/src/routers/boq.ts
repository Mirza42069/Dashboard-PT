import { db } from "@DashboardV2/db";
import {
  DISTRIBUTION_TYPES,
  PROGRESS_MODES,
  WEIGHT_SOURCES,
  boqImport,
  boqItem,
  boqItemDistribution,
  boqVersion,
  progressEntry,
  project,
  reportingPeriod,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
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
import { assertProjectAccess } from "../lib/scope";

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

/** Audit label for the project — the company filter doubles as the scope check. */
async function projectLabel(companyId: string, projectId: string) {
  const [row] = await db
    .select({ code: project.code, name: project.name })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.companyId, companyId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return `${row.code} - ${row.name}`;
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
  overview: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), versionId: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const versions = await db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId))
        .orderBy(desc(boqVersion.versionNo));

      const current = input.versionId
        ? versions.find((row) => row.id === input.versionId)
        : (versions.find((row) => row.status === "draft") ??
          versions.find((row) => row.status === "active") ??
          versions[0]);
      if (input.versionId && !current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "BoQ version not found" });
      }
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

  listVersions: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const versions = await db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId))
        .orderBy(desc(boqVersion.versionNo));
      return versions.map(serializeVersion);
    }),

  /**
   * Opens the BoQ for editing. An active baseline is deep-cloned so edits never
   * rewrite the contract, plan or progress history currently in force.
   */
  getOrCreateDraft: companyPermissionProcedure("project:write")
    .input(z.object({ projectId: z.string().min(1), title: z.string().trim().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      const label = await projectLabel(ctx.companyId, input.projectId);

      const [existing] = await db
        .select()
        .from(boqVersion)
        .where(and(eq(boqVersion.projectId, input.projectId), eq(boqVersion.status, "draft")))
        .orderBy(desc(boqVersion.versionNo))
        .limit(1);

      if (existing) return { version: serializeVersion(existing) };

      const versions = await db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, input.projectId))
        .orderBy(desc(boqVersion.versionNo));

      const versionNo = (versions[0]?.versionNo ?? 0) + 1;
      const active = versions.find((version) => version.status === "active");
      const versionId = crypto.randomUUID();

      if (!active) {
        const [created] = await db
          .insert(boqVersion)
          .values({
            id: versionId,
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
      }

      const sourceItems = await db
        .select()
        .from(boqItem)
        .where(and(eq(boqItem.boqVersionId, active.id), isNull(boqItem.deletedAt)))
        .orderBy(asc(boqItem.sortOrder));
      const sourceIds = sourceItems.map((item) => item.id);
      const [sourceDistribution, sourceProgress] =
        sourceIds.length === 0
          ? [[], []]
          : await Promise.all([
              db
                .select()
                .from(boqItemDistribution)
                .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
                .where(eq(boqItem.boqVersionId, active.id)),
              db
                .select()
                .from(progressEntry)
                .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
                .where(eq(boqItem.boqVersionId, active.id)),
            ]);

      const itemIds = new Map(sourceItems.map((item) => [item.id, crypto.randomUUID()]));
      const statements: Parameters<typeof runBatch>[0] = [
        db.insert(boqVersion).values({
          id: versionId,
          projectId: input.projectId,
          versionNo,
          sourceVersionId: active.id,
          title: input.title ?? `Rev ${versionNo}`,
          status: "draft",
          scheduleStatus: "draft",
        }),
      ];

      if (sourceItems.length > 0) {
        statements.push(
          db.insert(boqItem).values(
            sourceItems.map((item) => ({
              id: itemIds.get(item.id)!,
              boqVersionId: versionId,
              lineageId: item.lineageId,
              parentId: item.parentId ? (itemIds.get(item.parentId) ?? null) : null,
              code: item.code,
              description: item.description,
              unit: item.unit,
              quantity: item.quantity,
              unitRate: item.unitRate,
              weight: item.weight,
              weightSource: item.weightSource,
              distribution: item.distribution,
              progressMode: item.progressMode,
              plannedStartPeriodIndex: item.plannedStartPeriodIndex,
              plannedFinishPeriodIndex: item.plannedFinishPeriodIndex,
              sortOrder: item.sortOrder,
            })),
          ),
        );
      }

      if (sourceDistribution.length > 0) {
        statements.push(
          db.insert(boqItemDistribution).values(
            sourceDistribution.map(({ boq_item_distribution: cell }) => ({
              boqItemId: itemIds.get(cell.boqItemId)!,
              periodId: cell.periodId,
              plannedPct: cell.plannedPct,
            })),
          ),
        );
      }

      if (sourceProgress.length > 0) {
        statements.push(
          db.insert(progressEntry).values(
            sourceProgress.map(({ progress_entry: entry }) => ({
              projectId: entry.projectId,
              periodId: entry.periodId,
              boqItemId: itemIds.get(entry.boqItemId)!,
              cumulativeQuantity: entry.cumulativeQuantity,
              cumulativePercent: entry.cumulativePercent,
              pctComplete: entry.pctComplete,
              note: entry.note,
              recordedById: entry.recordedById,
            })),
          ),
        );
      }

      await runBatch(statements);
      const created = await getVersion(ctx, versionId);

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
  recalcWeights: companyPermissionProcedure("project:write")
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireDraft(ctx, input.versionId);
      await recalcWeights(input.versionId);
      const version = await getVersion(ctx, input.versionId);
      return { version: serializeVersion(version), weightTotal: await leafWeightTotal(input.versionId) };
    }),

  /**
   * Baselines the BoQ.
   *
   * A prior active baseline is superseded in the same database batch. Its items,
   * schedule and progress remain intact as the historical snapshot.
   */
  activate: companyPermissionProcedure("project:write")
    .input(z.object({ versionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const draft = await getVersion(ctx, input.versionId);
      const activatable =
        draft.scheduleStatus === "draft" &&
        (draft.status === "draft" || draft.status === "active");
      if (!activatable) {
        throw new TRPCError({ code: "CONFLICT", message: "This baseline is not an editable draft." });
      }
      await recalcWeights(input.versionId);
      const total = await leafWeightTotal(input.versionId);
      if (Math.abs(total - 100) > WEIGHT_TOLERANCE) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Weights must total 100% before baselining — they currently total ${total.toFixed(2)}%. Add priced items, or check any manually weighted lines.`,
        });
      }

      const [periods, leaves, distribution] = await Promise.all([
        db
          .select({ id: reportingPeriod.id })
          .from(reportingPeriod)
          .where(eq(reportingPeriod.projectId, draft.projectId)),
        db
          .select({ id: boqItem.id })
          .from(boqItem)
          .where(
            and(
              eq(boqItem.boqVersionId, input.versionId),
              isNull(boqItem.deletedAt),
              leafPredicate("boq_item"),
            ),
          ),
        db
          .select({ boqItemId: boqItemDistribution.boqItemId, plannedPct: boqItemDistribution.plannedPct })
          .from(boqItemDistribution)
          .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
          .where(eq(boqItem.boqVersionId, input.versionId)),
      ]);
      if (periods.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "Generate reporting periods first." });
      }
      if (leaves.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: "The BoQ has no schedulable lines." });
      }
      const scheduleTotals = new Map<string, number>();
      for (const cell of distribution) {
        scheduleTotals.set(
          cell.boqItemId,
          (scheduleTotals.get(cell.boqItemId) ?? 0) + Number(cell.plannedPct),
        );
      }
      const incomplete = leaves.filter(
        (leaf) => Math.abs((scheduleTotals.get(leaf.id) ?? 0) - 100) > WEIGHT_TOLERANCE,
      );
      if (incomplete.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${incomplete.length} schedule row(s) must total 100% before activation.`,
        });
      }

      const now = new Date();
      const [currentActive] = await db
        .select({ id: boqVersion.id })
        .from(boqVersion)
        .where(and(eq(boqVersion.projectId, draft.projectId), eq(boqVersion.status, "active")));
      const statements: Parameters<typeof runBatch>[0] = [
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${draft.projectId}, 0))`),
        db.execute(sql`
          select 1 / case when
            exists (
              select 1 from reporting_period
              where project_id = ${draft.projectId}
            )
            and exists (
              select 1 from boq_item
              where boq_version_id = ${input.versionId} and deleted_at is null
                and not exists (
                  select 1 from boq_item child
                  where child.parent_id = boq_item.id and child.deleted_at is null
                )
            )
            and not exists (
              select 1 from boq_item item
              where item.boq_version_id = ${input.versionId} and item.deleted_at is null
                and not exists (
                  select 1 from boq_item child
                  where child.parent_id = item.id and child.deleted_at is null
                )
                and abs(coalesce((
                  select sum(distribution.planned_pct)
                  from boq_item_distribution distribution
                  where distribution.boq_item_id = item.id
                ), 0) - 100) > ${WEIGHT_TOLERANCE}
            )
            and exists (
              select 1 from boq_version
              where id = ${input.versionId} and schedule_status = 'draft'
                and status in ('draft', 'active')
            )
          then 1 else 0 end
        `),
      ];

      if (currentActive && currentActive.id !== input.versionId) {
        const [sourceItems, targetItems, latestProgress] = await Promise.all([
          db
            .select({ id: boqItem.id, lineageId: boqItem.lineageId })
            .from(boqItem)
            .where(eq(boqItem.boqVersionId, currentActive.id)),
          db
            .select({ id: boqItem.id, lineageId: boqItem.lineageId })
            .from(boqItem)
            .where(eq(boqItem.boqVersionId, input.versionId)),
          db
            .select({ entry: progressEntry, itemId: boqItem.id })
            .from(progressEntry)
            .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
            .where(eq(boqItem.boqVersionId, currentActive.id)),
        ]);
        const sourceLineage = new Map(sourceItems.map((item) => [item.id, item.lineageId]));
        const targetByLineage = new Map(targetItems.map((item) => [item.lineageId, item.id]));
        const carried = latestProgress.flatMap(({ entry, itemId }) => {
          const targetId = targetByLineage.get(sourceLineage.get(itemId) ?? "");
          return targetId
            ? [
                {
                  projectId: entry.projectId,
                  periodId: entry.periodId,
                  boqItemId: targetId,
                  cumulativeQuantity: entry.cumulativeQuantity,
                  cumulativePercent: entry.cumulativePercent,
                  pctComplete: entry.pctComplete,
                  note: entry.note,
                  recordedById: entry.recordedById,
                },
              ]
            : [];
        });
        if (carried.length > 0) {
          statements.push(
            db
              .insert(progressEntry)
              .values(carried)
              .onConflictDoUpdate({
                target: [progressEntry.periodId, progressEntry.boqItemId],
                set: {
                  cumulativeQuantity: sql`excluded.cumulative_quantity`,
                  cumulativePercent: sql`excluded.cumulative_percent`,
                  pctComplete: sql`excluded.pct_complete`,
                  note: sql`excluded.note`,
                  recordedById: sql`excluded.recorded_by_id`,
                  updatedAt: now,
                },
              }),
          );
        }
      }

      if (currentActive && currentActive.id !== input.versionId) {
        statements.push(
          db
          .update(boqVersion)
          .set({ status: "superseded" })
          .where(eq(boqVersion.id, currentActive.id)),
        );
      }
      statements.push(
        db
          .update(boqVersion)
          .set({
            status: "active",
            scheduleStatus: "active",
            baselinedAt: now,
            baselinedById: ctx.session.user.id,
            scheduleBaselinedAt: now,
            scheduleBaselinedById: ctx.session.user.id,
          })
          .where(eq(boqVersion.id, input.versionId)),
      );
      try {
        await runBatch(statements);
      } catch (error) {
        if (error instanceof Error && error.message.toLowerCase().includes("division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "The baseline changed while it was being activated. Review it and try again.",
          });
        }
        throw error;
      }
      const activated = await getVersion(ctx, input.versionId);

      await recordActivity(ctx, {
        action: "baselined",
        entityType: "boq",
        entityId: activated.id,
        entityLabel: await projectLabel(ctx.companyId, activated.projectId),
        detail: `${activated.title} - BoQ and schedule`,
      });

      return { version: serializeVersion(activated) };
    }),

  /**
   * The spreadsheet imports this project has seen — filename, who ran it, when,
   * and how it went. Read-only history; the import itself is a plain HTTP route
   * because it carries a binary body (apps/server/src/boq-import.ts).
   */
  listImports: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const rows = await db
        .select({
          id: boqImport.id,
          filename: boqImport.filename,
          sheetName: boqImport.sheetName,
          importedByName: boqImport.importedByName,
          status: boqImport.status,
          rowsImported: boqImport.rowsImported,
          errorCount: boqImport.errorCount,
          createdAt: boqImport.createdAt,
          versionNo: boqVersion.versionNo,
        })
        .from(boqImport)
        .leftJoin(boqVersion, eq(boqVersion.id, boqImport.boqVersionId))
        .where(eq(boqImport.projectId, input.projectId))
        .orderBy(desc(boqImport.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /** Adds a section (no parentId) or a line under one. */
  createItem: companyPermissionProcedure("project:write")
    .input(
      itemSchema.extend({
        versionId: z.string().min(1),
        parentId: z.string().min(1).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireDraft(ctx, input.versionId);

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

  updateItem: companyPermissionProcedure("project:write")
    .input(itemSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const current = await requireDraftForItem(ctx, input.id);
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
  deleteItem: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requireDraftForItem(ctx, input.id);

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
  reorderItems: companyPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        orderedIds: z.array(z.string().min(1)).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireDraft(ctx, input.versionId);

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
