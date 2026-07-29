import { db } from "@DashboardV2/db";
import { boqItem, boqVersion, project } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";

import { toAmount } from "./money";
import { roleOf } from "./permissions";
import { assertMember, type ProjectScopeCtx } from "./scope";

/**
 * Shared BoQ machinery.
 *
 * The old system did this work in Postgres triggers and stored procedures. Here
 * it lives in the API layer, matching how material stock is handled — with two
 * exceptions that stay in SQL because they must be atomic and the Neon HTTP
 * driver has no interactive transactions:
 *
 *   - the weight recalculation, which is one UPDATE only because `value` is a
 *     generated column and Postgres can therefore do the whole sum-and-divide
 *     without a read-modify-write round trip;
 *   - the activation, whose validity check is folded into its own WHERE clause
 *     so nothing can change between validating and activating.
 */

/**
 * How far the leaf weights may drift from 100% and still be baselined. Weights
 * are stored to six decimal places and rounding across a few hundred lines can
 * legitimately leave a fraction on the table; anything past half a percent is a
 * real modelling error, not rounding.
 */
export const WEIGHT_TOLERANCE = 0.5;

/**
 * A *leaf* is a line with no live children. Weight, planned distribution and
 * progress all attach to leaves only — sections are pure rollups. Written as a
 * NOT EXISTS rather than a level check because the tree has no fixed depth: a
 * section with no children is a leaf and prices itself, which is what makes a
 * flat BoQ work without special-casing.
 *
 * `alias` is the name the boq_item table carries in the surrounding query.
 */
export function leafPredicate(alias: string) {
  return sql.raw(
    `not exists (select 1 from boq_item child where child.parent_id = ${alias}.id and child.deleted_at is null)`,
  );
}

/**
 * Company + project-membership scoping for the BoQ tree.
 *
 * A version, item or period names its project only indirectly, so every lookup
 * joins back to `project` and filters on the company (and, for role=user, on
 * project_member). Threading `ctx` through these helpers rather than checking
 * it at each call site means a new procedure cannot forget it — there is no
 * way to reach a version without passing one.
 *
 * Out-of-scope ids read as NOT_FOUND, never FORBIDDEN, matching lib/scope.ts:
 * a "forbidden" would confirm to one tenant that another tenant's row exists.
 */
export async function getVersion(ctx: ProjectScopeCtx, versionId: string) {
  const [row] = await db
    .select({ version: boqVersion, companyId: project.companyId, projectId: project.id })
    .from(boqVersion)
    .innerJoin(project, eq(project.id, boqVersion.projectId))
    .where(eq(boqVersion.id, versionId));

  if (!row || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "BoQ version not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, "BoQ version not found");
  }
  return row.version;
}

/**
 * Editing gate. Once a BoQ is baselined its quantities are the contract the
 * progress figures are measured against — letting them move afterwards would
 * silently rewrite every deviation already reported.
 */
export async function requireDraft(ctx: ProjectScopeCtx, versionId: string) {
  const version = await getVersion(ctx, versionId);
  if (version.status !== "draft") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This BoQ is baselined. Quantities can no longer be edited.",
    });
  }
  return version;
}

/** Same gate, entered from an item rather than its version. */
export async function requireDraftForItem(ctx: ProjectScopeCtx, itemId: string) {
  const [row] = await db
    .select({
      item: boqItem,
      versionStatus: boqVersion.status,
      companyId: project.companyId,
      projectId: project.id,
    })
    .from(boqItem)
    .innerJoin(boqVersion, eq(boqVersion.id, boqItem.boqVersionId))
    .innerJoin(project, eq(project.id, boqVersion.projectId))
    .where(eq(boqItem.id, itemId));

  if (!row || row.item.deletedAt !== null || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "BoQ item not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, "BoQ item not found");
  }
  if (row.versionStatus !== "draft") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This BoQ is baselined. Quantities can no longer be edited.",
    });
  }
  return row.item;
}

/**
 * Redistributes weight across the derived leaves in proportion to their value.
 *
 * Leaves marked `manual` are left exactly as they are and are excluded from the
 * denominator, so a hand-set weight keeps its number. The cost of that is that
 * mixing the two can leave the total off 100 — which is precisely what the
 * activation check exists to catch, so the error surfaces at baseline time
 * rather than silently skewing every later percentage.
 */
export function recalcWeightsStatement(versionId: string) {
  return sql`
    update boq_item
    set weight = case
          when totals.total > 0 then round(coalesce(boq_item.value, 0) / totals.total * 100, 6)
          else 0
        end,
        updated_at = now()
    from (
      select coalesce(sum(coalesce(leaf.value, 0)), 0) as total
      from boq_item leaf
      where leaf.boq_version_id = ${versionId}
        and leaf.weight_source = 'derived'
        and leaf.deleted_at is null
        and ${leafPredicate("leaf")}
    ) as totals
    where boq_item.boq_version_id = ${versionId}
      and boq_item.weight_source = 'derived'
      and boq_item.deleted_at is null
      and ${leafPredicate("boq_item")}
  `;
}

/**
 * Caches the contract total on the version. Every live leaf counts, manual
 * weights included — this is the money figure the grid footer shows, not the
 * weighting denominator. Being a cache, it is safe for this to land separately
 * from the recalculation above.
 */
export function refreshTotalValueStatement(versionId: string) {
  return sql`
    update boq_version
    set total_value = coalesce((
          select sum(coalesce(leaf.value, 0))
          from boq_item leaf
          where leaf.boq_version_id = ${versionId}
            and leaf.deleted_at is null
            and ${leafPredicate("leaf")}
        ), 0),
        updated_at = now()
    where id = ${versionId}
  `;
}

export async function recalcWeights(versionId: string) {
  await db.execute(recalcWeightsStatement(versionId));
  await db.execute(refreshTotalValueStatement(versionId));
}

/** Sum of the live leaf weights — what activation validates against 100. */
export async function leafWeightTotal(versionId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${boqItem.weight})` })
    .from(boqItem)
    .where(
      sql`${boqItem.boqVersionId} = ${versionId} and ${boqItem.deletedAt} is null and ${leafPredicate("boq_item")}`,
    );
  return toAmount(row?.total);
}

export type SerializedBoqItem = ReturnType<typeof serializeItem>;

/** Numeric strings become numbers here and nowhere else. */
export function serializeItem(row: typeof boqItem.$inferSelect) {
  return {
    id: row.id,
    boqVersionId: row.boqVersionId,
    lineageId: row.lineageId,
    parentId: row.parentId,
    code: row.code,
    description: row.description,
    unit: row.unit,
    quantity: row.quantity === null ? null : toAmount(row.quantity),
    unitRate: row.unitRate === null ? null : toAmount(row.unitRate),
    value: row.value === null ? null : toAmount(row.value),
    weight: toAmount(row.weight),
    weightSource: row.weightSource,
    distribution: row.distribution,
    progressMode: row.progressMode,
    sortOrder: row.sortOrder,
  };
}

export function serializeVersion(row: typeof boqVersion.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    versionNo: row.versionNo,
    sourceVersionId: row.sourceVersionId,
    title: row.title,
    status: row.status,
    scheduleStatus: row.scheduleStatus,
    totalValue: toAmount(row.totalValue),
    baselinedAt: row.baselinedAt,
    scheduleBaselinedAt: row.scheduleBaselinedAt,
  };
}

/**
 * Resolves a reading to a 0-100 completion figure.
 *
 * By-quantity items divide by their contracted quantity; a quantity of zero or
 * null has nothing to measure against and reads as 0 rather than dividing by
 * zero. Both modes clamp: over-delivering does not put a line past complete,
 * because the weighting assumes each leaf tops out at its own weight.
 */
export function computePctComplete(input: {
  progressMode: "by_quantity" | "by_percent";
  quantity: number | null;
  cumulativeQuantity: number | null;
  cumulativePercent: number | null;
}): number {
  const raw =
    input.progressMode === "by_quantity"
      ? input.quantity === null || input.quantity === 0
        ? 0
        : ((input.cumulativeQuantity ?? 0) / input.quantity) * 100
      : (input.cumulativePercent ?? 0);

  return Math.min(100, Math.max(0, raw));
}

/**
 * A row is only a *reading* if one of the cumulative columns holds a value.
 * Clearing a cell leaves the row behind with both null, and that is not the
 * same as reporting zero — see the progressEntry docblock.
 */
export function isRealReading(entry: {
  cumulativeQuantity: number | null;
  cumulativePercent: number | null;
}): boolean {
  return entry.cumulativeQuantity !== null || entry.cumulativePercent !== null;
}
