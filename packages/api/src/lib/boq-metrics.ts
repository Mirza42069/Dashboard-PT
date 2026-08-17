import { db } from "@DashboardV2/db";
import { project } from "@DashboardV2/db/schema";
import { type SQL, inArray, sql } from "drizzle-orm";

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
const itemizedActualPercentAt = (asOf: SQL) => sql<string | null>`(
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
      and period.end_date <= ${asOf}
      and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
    order by period.end_date desc
    limit 1
  ) reading on true
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
    and version.schedule_status = 'active'
)`;

const importedActualPercentAt = (asOf: SQL) => sql<string | null>`(
  select snapshot.cumulative_percent
  from project_actual_curve snapshot
  join reporting_period period on period.id = snapshot.period_id
  where snapshot.project_id = ${outerProjectId}
    and period.end_date <= ${asOf}
  order by period.end_date desc
  limit 1
)`;

/** The newest source wins; item readings win when both sources share a period. */
const latestActualSourceAt = (asOf: SQL) => sql<string | null>`(
  select source
  from (
    select period.end_date, 1 as priority, 'itemized' as source
    from progress_entry entry
    join boq_item item on item.id = entry.boq_item_id
    join boq_version version on version.id = item.boq_version_id
    join reporting_period period on period.id = entry.period_id
    where version.project_id = ${outerProjectId}
      and version.status = 'active'
      and version.schedule_status = 'active'
      and period.end_date <= ${asOf}
      and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
    union all
    select period.end_date, 0 as priority, 'imported' as source
    from project_actual_curve snapshot
    join reporting_period period on period.id = snapshot.period_id
    where snapshot.project_id = ${outerProjectId}
      and period.end_date <= ${asOf}
  ) sources
  order by end_date desc, priority desc
  limit 1
)`;

const actualPercentAt = (asOf: SQL) => sql<string | null>`case
  when ${latestActualSourceAt(asOf)} = 'itemized' then ${itemizedActualPercentAt(asOf)}
  else ${importedActualPercentAt(asOf)}
end`;

const actualPercent = actualPercentAt(outerDataDate);

/** Contract value belongs to the complete active baseline, never a draft revision. */
const activeContractValue = sql<string | null>`(
  select version.total_value
  from boq_version version
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
    and version.schedule_status = 'active'
  order by version.version_no desc
  limit 1
)`;

/** Contract-rate value of measured work, calculated from each line rather than progress weights. */
const itemizedWorkCompletedValueAt = (asOf: SQL) => sql<string | null>`(
  select sum(coalesce(item.value, 0) * reading.pct_complete / 100.0)
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
      and period.end_date <= ${asOf}
      and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
    order by period.end_date desc
    limit 1
  ) reading on true
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
    and version.schedule_status = 'active'
)`;

const workCompletedValue = sql<string | null>`case
  when ${latestActualSourceAt(outerDataDate)} = 'itemized' then ${itemizedWorkCompletedValueAt(outerDataDate)}
  else (${activeContractValue}) * (${importedActualPercentAt(outerDataDate)}) / 100.0
end`;

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
    and version.schedule_status = 'active'
    and ${outerDataDate} is not null
    and period.end_date <= ${outerDataDate}
)`;

const hasBaseline = sql<boolean>`exists (
  select 1 from boq_version version
  where version.project_id = ${outerProjectId}
    and version.status = 'active'
    and version.schedule_status = 'active'
)`;

export type BoqMetrics = {
  contractValue: number;
  workCompletedValue: number | null;
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
      contractValue: activeContractValue,
      workCompletedValue,
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
      contractValue: toAmount(row.contractValue),
      workCompletedValue:
        row.workCompletedValue === null ? null : roundAmount(toAmount(row.workCompletedValue)),
      // No data date means nobody has reported yet. A deviation of "0" would
      // read as on-track; null renders as "—".
      deviation: row.dataDate === null ? null : roundAmount(progress - planned),
      dataDate: row.dataDate,
    });
  }

  return metrics;
}

/**
 * Planned and actual as at the *previous* reported period, so a card can say
 * which way a project moved rather than only where it stands.
 *
 * "Previous" is the last period ending strictly before the data date that
 * actually holds a reading — not simply data date minus one cadence. Sites miss
 * weeks, and comparing against a week nobody reported would manufacture a swing
 * out of the gap.
 */
const previousDataDate = sql<string | null>`(
  select max(period.end_date)
  from reporting_period period
  where period.project_id = ${outerProjectId}
    and period.end_date < ${outerDataDate}
    and (
      exists (
        select 1 from progress_entry entry
        where entry.period_id = period.id
          and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
      )
      or exists (
        select 1 from project_actual_curve snapshot
        where snapshot.project_id = ${outerProjectId}
          and snapshot.period_id = period.id
      )
    )
)`;

const plannedPercentAt = (asOf: SQL<string | null>) => sql<string | null>`(
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
    and version.schedule_status = 'active'
    and ${asOf} is not null
    and period.end_date <= ${asOf}
)`;

/** Periods whose end date has passed but which are not yet submitted. */
const reportsDue = sql<number>`(
  select count(*)
  from reporting_period period
  where period.project_id = ${outerProjectId}
    and period.end_date < current_date
    and period.status in ('open', 'draft', 'returned')
)`;

/** Submitted or reviewed and waiting on somebody to approve or return them. */
const reportsAwaitingReview = sql<number>`(
  select count(*)
  from reporting_period period
  where period.project_id = ${outerProjectId}
    and period.status in ('submitted', 'reviewed')
)`;

/**
 * Days since the data date. The freshness figure — a project reporting on time
 * and a project that went quiet in March both show a deviation, and only this
 * tells them apart.
 */
const reportAgeDays = sql<number | null>`(
  case when ${outerDataDate} is null then null
       else current_date - ${outerDataDate} end
)`;

export type ProjectException = BoqMetrics & {
  projectId: string;
  code: string;
  name: string;
  status: string;
  hasBaseline: boolean;
  /** Deviation at the previous reported period, for the change-over-time figure. */
  previousDeviation: number | null;
  /** Periods past their end date with no submission. */
  reportsDue: number;
  reportsAwaitingReview: number;
  /** Days between the data date and today. Null when nothing has been reported. */
  reportAgeDays: number | null;
  openTickets: number;
};

/**
 * The portfolio, ranked by what needs attention.
 *
 * One query rather than boqMetricsByProject plus a fan-out: the dashboard shows
 * every project at once and the per-project version would be a round trip
 * apiece. Filtering happens in the caller, so this stays the single source of
 * "how is each project doing" for both the cards and the exception list.
 */
export async function projectExceptions(where: SQL | undefined) {
  const rows = await db
    .select({
      projectId: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      manualProgress: project.progress,
      dataDate: project.dataDate,
      actual: actualPercent,
      planned: plannedPercent,
      previousActual: actualPercentAt(previousDataDate),
      previousPlanned: plannedPercentAt(previousDataDate),
      hasBaseline,
      contractValue: activeContractValue,
      workCompletedValue,
      reportsDue,
      reportsAwaitingReview,
      reportAgeDays,
      openTickets: sql<number>`(
        select count(*) from ticket
        where ticket.project_id = ${outerProjectId} and ticket.status <> 'closed'
      )`,
    })
    .from(project)
    .where(where);

  return rows.map((row): ProjectException => {
    const progress = roundAmount(toAmount(row.actual));
    const planned = roundAmount(toAmount(row.planned));
    const previousDeviation =
      row.previousActual === null
        ? null
        : roundAmount(roundAmount(toAmount(row.previousActual)) - roundAmount(toAmount(row.previousPlanned)));

    return {
      projectId: row.projectId,
      code: row.code,
      name: row.name,
      status: row.status,
      hasBaseline: row.hasBaseline,
      progress: row.hasBaseline ? progress : Number(row.manualProgress ?? 0),
      planned: row.hasBaseline ? planned : 0,
      contractValue: toAmount(row.contractValue),
      workCompletedValue:
        row.workCompletedValue === null ? null : roundAmount(toAmount(row.workCompletedValue)),
      deviation: !row.hasBaseline || row.dataDate === null ? null : roundAmount(progress - planned),
      dataDate: row.dataDate,
      previousDeviation: row.hasBaseline ? previousDeviation : null,
      reportsDue: Number(row.reportsDue ?? 0),
      reportsAwaitingReview: Number(row.reportsAwaitingReview ?? 0),
      reportAgeDays: row.reportAgeDays === null ? null : Number(row.reportAgeDays),
      openTickets: Number(row.openTickets ?? 0),
    };
  });
}

/**
 * Recomputes a project's data date from its readings. One statement, so it can
 * ride along in the same batch as the progress upsert it follows.
 */
export function refreshDataDateStatement(projectId: string) {
  return sql`
    update project
    set data_date = (
      select max(reported.end_date)
      from (
        select period.end_date
        from progress_entry entry
        join reporting_period period on period.id = entry.period_id
        where period.project_id = ${projectId}
          and (entry.cumulative_percent is not null or entry.cumulative_quantity is not null)
        union all
        select period.end_date
        from project_actual_curve snapshot
        join reporting_period period on period.id = snapshot.period_id
        where snapshot.project_id = ${projectId}
      ) reported
    )
    where id = ${projectId}
  `;
}
