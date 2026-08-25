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
import { databaseErrorIncludes } from "../lib/database-error";
import {
  WEIGHT_TOLERANCE,
  getWritableVersion,
  leafPredicate,
  leafWeightTotal,
  recalcWeights,
  recalcWeightsStatement,
  refreshTotalValueStatement,
  requireDraft,
  requireDraftForItem,
  serializeItem,
  serializeVersion,
} from "../lib/boq";
import {
  formatNumber,
  interpolate,
  type MessageDictionary,
  plural,
} from "../lib/messages/index";
import { assertProjectAccess, assertProjectWritable } from "../lib/scope";

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
async function projectLabel(t: MessageDictionary, companyId: string, projectId: string) {
  const [row] = await db
    .select({ code: project.code, name: project.name })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.companyId, companyId)));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: t.project.notFound });
  }
  return `${row.code} - ${row.name}`;
}

async function runDraftMutation(
  t: MessageDictionary,
  projectId: string,
  versionId: string,
  statements: Parameters<typeof runBatch>[0],
) {
  try {
    await runBatch([
      db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`),
      db.execute(sql`
        select 1 / case when exists (
          select 1 from boq_version
          where id = ${versionId} and project_id = ${projectId} and status = 'draft'
        ) then 1 else 0 end
      `),
      ...statements,
    ]);
  } catch (error) {
    if (databaseErrorIncludes(error, "division by zero")) {
      throw new TRPCError({
        code: "CONFLICT",
        message: t.boq.baselinedWhileEditing,
      });
    }
    throw error;
  }
}

function liveItemsGuard(versionId: string, itemIds: string[]) {
  const ids = sql.join(itemIds.map((id) => sql`${id}`), sql`, `);
  return db.execute(sql`
    select 1 / case when (
      select count(distinct id) from boq_item
      where boq_version_id = ${versionId}
        and deleted_at is null
        and id in (${ids})
    ) = ${itemIds.length} then 1 else 0 end
  `);
}

/** Rejects a code that already exists among the item's siblings. */
async function assertCodeFree(t: MessageDictionary, input: {
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
      message: interpolate(t.boq.codeUsedAtLevel, { code: input.code }),
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
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.boq.versionNotFound });
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
      await assertProjectWritable(ctx, input.projectId);
      const label = await projectLabel(ctx.t, ctx.companyId, input.projectId);

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
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: ctx.t.boq.couldNotCreate });
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
              noProgress: entry.noProgress,
              note: entry.note,
              recordedById: entry.recordedById,
            })),
          ),
        );
      }

      await runBatch(statements);
      const created = await getWritableVersion(ctx, versionId);

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
      const draft = await requireDraft(ctx, input.versionId);
      await runDraftMutation(ctx.t, draft.projectId, input.versionId, [
        db.execute(recalcWeightsStatement(input.versionId)),
        db.execute(refreshTotalValueStatement(input.versionId)),
      ]);
      const version = await getWritableVersion(ctx, input.versionId);
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
      const draft = await getWritableVersion(ctx, input.versionId);
      const activatable =
        draft.scheduleStatus === "draft" &&
        (draft.status === "draft" || draft.status === "active");
      if (!activatable) {
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.boq.notEditableDraft });
      }
      await recalcWeights(input.versionId);
      const total = await leafWeightTotal(input.versionId);
      if (Math.abs(total - 100) > WEIGHT_TOLERANCE) {
        throw new TRPCError({
          code: "CONFLICT",
          message: interpolate(ctx.t.boq.weightsMustTotal, {
            total: formatNumber(ctx.locale, total),
          }),
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
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.schedule.generatePeriodsFirst });
      }
      if (leaves.length === 0) {
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.boq.noSchedulableLines });
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
          message: plural(ctx.t.boq.scheduleRowsIncomplete, incomplete.length),
        });
      }

      const now = new Date();
      const statements: Parameters<typeof runBatch>[0] = [
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${draft.projectId}, 0))`),
        db.execute(recalcWeightsStatement(input.versionId)),
        db.execute(refreshTotalValueStatement(input.versionId)),
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
            and abs(coalesce((
              select sum(item.weight)
              from boq_item item
              where item.boq_version_id = ${input.versionId}
                and item.deleted_at is null
                and not exists (
                  select 1 from boq_item child
                  where child.parent_id = item.id and child.deleted_at is null
                )
            ), 0) - 100) <= ${WEIGHT_TOLERANCE}
            and exists (
              select 1 from boq_version
              where id = ${input.versionId} and schedule_status = 'draft'
                and status in ('draft', 'active')
            )
          then 1 else 0 end
        `),
      ];

      statements.push(
        db.execute(sql`
          insert into progress_entry
            (id, project_id, period_id, boq_item_id, cumulative_quantity,
             cumulative_percent, pct_complete, no_progress, note, recorded_by_id)
          select
            md5(entry.id || ':' || target.id), entry.project_id, entry.period_id, target.id,
            entry.cumulative_quantity, entry.cumulative_percent, entry.pct_complete,
            entry.no_progress, entry.note, entry.recorded_by_id
          from boq_version source_version
          join boq_item source on source.boq_version_id = source_version.id
          join boq_item target on target.boq_version_id = ${input.versionId}
            and target.lineage_id = source.lineage_id
          join progress_entry entry on entry.boq_item_id = source.id
          where source_version.project_id = ${draft.projectId}
            and source_version.status = 'active'
            and source_version.id <> ${input.versionId}
          on conflict (period_id, boq_item_id) do update set
            cumulative_quantity = excluded.cumulative_quantity,
            cumulative_percent = excluded.cumulative_percent,
            pct_complete = excluded.pct_complete,
            no_progress = excluded.no_progress,
            note = excluded.note,
            recorded_by_id = excluded.recorded_by_id,
            updated_at = ${now}
        `),
        db
          .update(boqVersion)
          .set({ status: "superseded" })
          .where(
            and(
              eq(boqVersion.projectId, draft.projectId),
              eq(boqVersion.status, "active"),
              sql`${boqVersion.id} <> ${input.versionId}`,
            ),
          ),
      );
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
        if (databaseErrorIncludes(error, "division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: ctx.t.boq.changedWhileActivating,
          });
        }
        throw error;
      }
      const activated = await getWritableVersion(ctx, input.versionId);

      await recordActivity(ctx, {
        action: "baselined",
        entityType: "boq",
        entityId: activated.id,
        entityLabel: await projectLabel(ctx.t, ctx.companyId, activated.projectId),
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
      const version = await requireDraft(ctx, input.versionId);

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
          throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.boq.parentSectionNotFound });
        }
      }

      await assertCodeFree(ctx.t, { versionId: input.versionId, parentId, code: input.code });

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

      const itemId = crypto.randomUUID();
      await runDraftMutation(ctx.t, version.projectId, input.versionId, [
        ...(parentId ? [liveItemsGuard(input.versionId, [parentId])] : []),
        db.insert(boqItem).values({
          id: itemId,
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
        }),
      ]);
      const [created] = await db.select().from(boqItem).where(eq(boqItem.id, itemId));

      return { item: created ? serializeItem(created) : null };
    }),

  updateItem: companyPermissionProcedure("project:write")
    .input(itemSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const current = await requireDraftForItem(ctx, input.id);
      const version = await getWritableVersion(ctx, current.boqVersionId);
      const { id, code, quantity, unitRate, weight, ...rest } = input;

      if (code && code !== current.code) {
        await assertCodeFree(ctx.t, {
          versionId: current.boqVersionId,
          parentId: current.parentId,
          code,
          exceptId: id,
        });
      }

      await runDraftMutation(ctx.t, version.projectId, current.boqVersionId, [
        liveItemsGuard(current.boqVersionId, [id]),
        db.update(boqItem).set({
          ...rest,
          ...(code ? { code } : {}),
          ...(quantity !== undefined
            ? { quantity: quantity === null ? null : toQuantityString(quantity) }
            : {}),
          ...(unitRate !== undefined
            ? { unitRate: unitRate === null ? null : toQuantityString(unitRate) }
            : {}),
          ...(weight !== undefined && weight !== null ? { weight: weight.toFixed(6) } : {}),
        }).where(eq(boqItem.id, id)),
      ]);

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
      const item = await requireDraftForItem(ctx, input.id);
      const version = await getWritableVersion(ctx, item.boqVersionId);

      try {
        await db.batch([
          db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${version.projectId}, 0))`),
          db.execute(sql`
            select 1 / case when exists (
              select 1 from boq_version
              where id = ${item.boqVersionId}
                and project_id = ${version.projectId}
                and status = 'draft'
            ) then 1 else 0 end
          `),
          db.execute(sql`
            update boq_item
            set deleted_at = now(), updated_at = now()
            where deleted_at is null
              and boq_version_id = ${item.boqVersionId}
              and id in (
                with recursive tree as (
                  select id from boq_item
                  where id = ${input.id} and boq_version_id = ${item.boqVersionId}
                  union all
                  select child.id from boq_item child join tree on child.parent_id = tree.id
                )
                select id from tree
              )
          `),
        ]);
      } catch (error) {
        if (databaseErrorIncludes(error, "division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: ctx.t.boq.baselinedWhileEditing,
          });
        }
        throw error;
      }

      return { success: true };
    }),

  /**
   * Bulk counterpart of deleteItem: the same recursive cascade, seeded from an
   * array instead of one id.
   *
   * Deliberately not a client-side loop over deleteItem. Two reasons beyond the
   * round trips: a selection can hold both a section and a line underneath it,
   * and deleting the section first makes the second call race its own cascade;
   * and a partial failure would leave a half-deleted tree, which is exactly the
   * parentless-leaves-still-drawing-weight state the cascade exists to prevent.
   *
   * The version is taken as input so the draft gate is one query rather than
   * one per id, and the statement is scoped to it so an id from another version
   * — or another company's project — matches nothing.
   */
  deleteItems: companyPermissionProcedure("project:write")
    .input(
      z.object({
        versionId: z.string().min(1),
        ids: z.array(z.string().min(1)).min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const version = await requireDraft(ctx, input.versionId);

      const ids = sql.join(
        input.ids.map((id) => sql`${id}`),
        sql`, `,
      );

      let count = 0;
      try {
        const [, , result] = await db.batch([
          db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${version.projectId}, 0))`),
          db.execute(sql`
            select 1 / case when exists (
              select 1 from boq_version
              where id = ${input.versionId}
                and project_id = ${version.projectId}
                and status = 'draft'
            ) then 1 else 0 end
          `),
          db.execute(sql`
            update boq_item
            set deleted_at = now(), updated_at = now()
            where deleted_at is null
              and boq_version_id = ${input.versionId}
              and id in (
                with recursive tree as (
                  select id from boq_item
                  where id in (${ids}) and boq_version_id = ${input.versionId}
                  union all
                  select child.id from boq_item child join tree on child.parent_id = tree.id
                )
                select id from tree
              )
          `),
        ]);
        count = result.rowCount ?? 0;
      } catch (error) {
        if (databaseErrorIncludes(error, "division by zero")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: ctx.t.boq.baselinedWhileEditing,
          });
        }
        throw error;
      }

      // The cascade means this is the number of *lines* removed, not the number
      // ticked — deleting one section can be twenty rows. That is the figure
      // worth reporting back.
      return { success: true, count };
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
      const version = await requireDraft(ctx, input.versionId);

      const rows = sql.join(
        input.orderedIds.map((id, index) => sql`(${id}::text, ${index}::int)`),
        sql`, `,
      );

      await runDraftMutation(ctx.t, version.projectId, input.versionId, [
        liveItemsGuard(input.versionId, input.orderedIds),
        db.execute(sql`
          update boq_item
          set sort_order = ordering.position, updated_at = now()
          from (values ${rows}) as ordering(id, position)
          where boq_item.id = ordering.id
            and boq_item.boq_version_id = ${input.versionId}
        `),
      ]);

      return { success: true };
    }),
});
