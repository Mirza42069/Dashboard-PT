import { db } from "@DashboardV2/db";
import { project } from "@DashboardV2/db/schema";
import { inArray, sql } from "drizzle-orm";

import { roundAmount, toAmount } from "./money";

/**
 * Project-level BoQ metrics: how far along the site actually is, how far along
 * it was meant to be, and the gap between them.
 *
 * Both figures are weighted sums over the leaves of the *active* baseline, and
 * both are measured at the project's data date — the end of the last period
 * anyone actually reported against. Comparing an actual that stops at week 6 to
 * a plan that runs to week 20 would report every project as catastrophically
 * behind, which is the failure this anchoring exists to prevent.
 */

/**
 * References to the outer `project` row.
 *
 * Written out rather than interpolated as drizzle columns: inside a selection
 * expression drizzle emits a bare `"id"`, which is ambiguous against the
 * aliased tables in these subqueries and makes Postgres reject the statement.
 * Qualifying them explicitly is what keeps the correlation unambiguous.
 */
const outerProjectId = sql.raw(`"project"."id"`);
const outerDataDate = sql.raw(`"project"."data_date"`);

/**
 * Latest reading per leaf, carried forward. The lateral picks the most recent
 * period that holds a real reading, so a leaf nobody has touched since week 3
 * still counts at its week-3 figure rather than dropping to zero.
 */
const actualPercent = sql<string | null>`(
  select sum(item.weight * reading.pct_complete / 100.0)
  from boq_version version
  join boq_item item
    on item.boq_version_id = version.id
   and item.deleted_at is null
   and not exists (
     select 1 from boq_item child
     where child.parent_id = item.id and child.deleted_at is null
   )
  join lateral (
    select entry.pct_complete
    from progress_entry entry
    join reporting_period period on period.id = entry.period_id
    where entry.boq_item_id = item.id
      and (${outerDataDate} is null or period.end_date <= ${outerDataDate})
      and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
    order by period.end_date desc
    limit 1
  ) reading on true
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
)`;

/** Everything the plan said should be finished by the data date. */
const plannedPercent = sql<string | null>`(
  select sum(item.weight * cell.planned_pct / 100.0)
  from boq_version version
  join boq_item item
    on item.boq_version_id = version.id
   and item.deleted_at is null
   and not exists (
     select 1 from boq_item child
     where child.parent_id = item.id and child.deleted_at is null
   )
  join boq_item_distribution cell on cell.boq_item_id = item.id
  join reporting_period period on period.id = cell.period_id
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
    and ${outerDataDate} is not null
    and period.end_date <= ${outerDataDate}
)`;

const hasBaseline = sql<boolean>`exists (
  select 1 from boq_version version
  where version.project_id = ${outerProjectId} and version.status = 'active'
)`;

export type BoqMetrics = {
  /** Weighted actual completion, 0-100. */
  progress: number;
  /** Weighted planned completion at the data date, 0-100. */
  planned: number;
  /** actual − planned. Negative means behind. Null until anything is reported. */
  deviation: number | null;
  dataDate: string | null;
};

/**
 * Metrics for many projects in one round trip, keyed by project id. Projects
 * without an active baseline are absent from the map — callers fall back to the
 * manually entered progress figure for those.
 */
export async function boqMetricsByProject(projectIds: string[]) {
  const metrics = new Map<string, BoqMetrics>();
  if (projectIds.length === 0) return metrics;

  const rows = await db
    .select({
      projectId: project.id,
      dataDate: project.dataDate,
      actual: actualPercent,
      planned: plannedPercent,
      hasBaseline,
    })
    .from(project)
    .where(inArray(project.id, projectIds));

  for (const row of rows) {
    if (!row.hasBaseline) continue;

    const progress = roundAmount(toAmount(row.actual));
    const planned = roundAmount(toAmount(row.planned));

    metrics.set(row.projectId, {
      progress,
      planned,
      // No data date means nobody has reported yet. A deviation of "0" would
      // read as on-track; null renders as "—".
      deviation: row.dataDate === null ? null : roundAmount(progress - planned),
      dataDate: row.dataDate,
    });
  }

  return metrics;
}

/**
 * Recomputes a project's data date from its readings. One statement, so it can
 * ride along in the same batch as the progress upsert it follows.
 */
export function refreshDataDateStatement(projectId: string) {
  return sql`
    update project
    set data_date = (
      select max(period.end_date)
      from reporting_period period
      where period.project_id = ${projectId}
        and exists (
          select 1 from progress_entry entry
          where entry.period_id = period.id
            and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
        )
    )
    where id = ${projectId}
  `;
}
