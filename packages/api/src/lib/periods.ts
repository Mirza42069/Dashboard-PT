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

    if (index > MAX_PERIODS) {
      throw new PeriodRangeError("That date range needs too many periods — check the contract dates.");
    }
  }

  return periods;
}
