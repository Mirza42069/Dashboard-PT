import type { PeriodType } from "@DashboardV2/db/schema";

/**
 * Reporting-period generation.
 *
 * All arithmetic is done in UTC on "YYYY-MM-DD" strings. Dates in this codebase
 * are plain calendar dates (see the note in the schema file) and constructing a
 * Date without an explicit Z would resolve it in the server's timezone, which
 * can shift a period boundary by a day depending on where the process happens
 * to be running.
 */

const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Guards against a typo in the contract dates spawning thousands of columns. */
export const MAX_PERIODS = 600;

export type GeneratedPeriod = {
  periodIndex: number;
  label: string;
  startDate: string;
  endDate: string;
};

export class PeriodRangeError extends Error {}

/** The inclusive end date of an exact number of reporting periods. */
export function endDateForPeriodCount(start: string, count: number, type: PeriodType): string {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PERIODS) {
    throw new PeriodRangeError(`The schedule must contain between 1 and ${MAX_PERIODS} periods.`);
  }
  let end = parse(start);
  if (Number.isNaN(end.getTime())) throw new PeriodRangeError("Choose a valid schedule start date.");

  for (let index = 0; index < count; index++) {
    if (type === "monthly") {
      end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0));
    } else {
      end = addDays(end, (type === "biweekly" ? 14 : 7) - 1);
    }
    if (index < count - 1) end = addDays(end, 1);
  }
  return iso(end);
}

/**
 * Buckets covering [start, finish] at the project's cadence. The last bucket is
 * clamped to `finish`, so the grid ends exactly on the contract date rather
 * than overshooting it — a half-week final column is honest, a week that runs
 * past the contract is not.
 */
export function generatePeriods(
  start: string,
  finish: string,
  type: PeriodType,
): GeneratedPeriod[] {
  const from = parse(start);
  const to = parse(finish);
  if (to < from) {
    throw new PeriodRangeError("The contract finish date is before the schedule start.");
  }

  const periods: GeneratedPeriod[] = [];
  let cursor = from;
  let index = 1;

  while (cursor <= to) {
    if (index > MAX_PERIODS) {
      throw new PeriodRangeError("That date range needs too many periods — check the contract dates.");
    }
    let end: Date;
    let label: string;

    if (type === "monthly") {
      // Day 0 of next month is the last day of this one. A mid-month start
      // therefore gives a short first bucket and whole months after it.
      end = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      label = `M${index}`;
    } else {
      end = addDays(cursor, (type === "biweekly" ? 14 : 7) - 1);
      label = `${type === "biweekly" ? "P" : "W"}${index}`;
    }

    if (end > to) end = to;

    periods.push({
      periodIndex: index,
      label,
      startDate: iso(cursor),
      endDate: iso(end),
    });

    cursor = addDays(end, 1);
    index++;
  }

  return periods;
}

/** A run of consecutive periods that belong to the same calendar month. */
export type MonthGroup = {
  /** "2026-05". Stable and sortable; the display name is formatted per locale. */
  monthKey: string;
  /** Index into the periods array the run starts at. */
  startIndex: number;
  /** How many periods the run covers — the header cell's colSpan. */
  span: number;
};

/**
 * Which month a period belongs to, when it straddles two.
 *
 * By the month holding **most of its days**, ties going to the month it starts
 * in. A week running 31 May - 6 June is a week of June work with a Sunday
 * attached, and filing it under May would put a bar in the wrong month band for
 * the sake of one day.
 *
 * This is not an invention: it is the rule the reference workbook already
 * follows. Its week 5 (31 May - 6 Jun) sits under JUNI and its week 13
 * (26 Jul - 1 Aug) under JULI, both of which fall out of counting days and
 * neither of which falls out of using the start date.
 */
export function monthKeyOf(period: { startDate: string; endDate: string }): string {
  const start = parse(period.startDate);
  const end = parse(period.endDate);
  const days = new Map<string, number>();

  // Bounded by MAX_SPAN_DAYS so a corrupt end date cannot spin here. A monthly
  // period is at most 31 days; anything past 62 spans three months and has no
  // meaningful "majority" anyway, so the start month is the honest answer.
  const MAX_SPAN_DAYS = 62;
  for (let cursor = start, guard = 0; cursor <= end && guard < MAX_SPAN_DAYS; guard++) {
    const key = iso(cursor).slice(0, 7);
    days.set(key, (days.get(key) ?? 0) + 1);
    cursor = addDays(cursor, 1);
  }

  const startKey = period.startDate.slice(0, 7);
  let best = startKey;
  let bestCount = days.get(startKey) ?? 0;
  for (const [key, count] of days) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Groups periods into the month bands a schedule grid puts above its columns.
 *
 * Consecutive runs, not a bucket per month: the grid draws these as spanning
 * header cells, so what it needs is where each run starts and how wide it is.
 */
export function groupPeriodsByMonth(
  periods: { startDate: string; endDate: string }[],
): MonthGroup[] {
  const groups: MonthGroup[] = [];

  periods.forEach((period, index) => {
    const monthKey = monthKeyOf(period);
    const last = groups[groups.length - 1];
    if (last && last.monthKey === monthKey) {
      last.span++;
      return;
    }
    groups.push({ monthKey, startIndex: index, span: 1 });
  });

  return groups;
}
