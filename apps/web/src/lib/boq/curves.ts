/**
 * The BoQ progress maths.
 *
 * Kept as pure functions over plain arrays, separate from any component, for
 * two reasons: the planned curve is needed by both the schedule footer and the
 * progress chart and must mean the same thing in both, and the carry-forward
 * rules below are subtle enough to be worth testing directly. See curves.test.ts
 * — those cases are the specification, not an afterthought.
 *
 * Every function takes periods in chronological order, which is how the API
 * returns them (ordered by periodIndex).
 */

export type BoqItemLike = {
  id: string;
  parentId: string | null;
  code: string;
  description: string;
  weight: number;
  sortOrder: number;
};

export type PeriodLike = { id: string; endDate: string };

export type EntryLike = {
  boqItemId: string;
  periodId: string;
  pctComplete: number;
  cumulativeQuantity: number | null;
  cumulativePercent: number | null;
};

export type LeafLike = { id: string; weight: number };

export type Section<T extends BoqItemLike> = { header: T; leaves: T[] };
export type ScheduleRow<T extends BoqItemLike> = { section: string; leaf: T };

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

/**
 * Groups the flat item list into sections and their lines, ordered the way the
 * grid shows them.
 */
export function buildSections<T extends BoqItemLike>(items: T[]): Section<T>[] {
  const sorted = [...items].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, undefined, { numeric: true }),
  );

  return sorted
    .filter((item) => item.parentId === null)
    .map((header) => ({
      header,
      leaves: sorted.filter((item) => item.parentId === header.id),
    }));
}

/**
 * The rows of the schedule and progress matrices: one per leaf. A section with
 * children contributes its children; a childless section prices itself and
 * appears as a single row. Mirrors the leaf rule the server weights by, so the
 * grid always shows exactly the lines that carry weight.
 */
export function scheduleRows<T extends BoqItemLike>(items: T[]): ScheduleRow<T>[] {
  const rows: ScheduleRow<T>[] = [];

  for (const section of buildSections(items)) {
    if (section.leaves.length > 0) {
      for (const leaf of section.leaves) {
        rows.push({ section: section.header.description, leaf });
      }
    } else {
      rows.push({ section: section.header.description, leaf: section.header });
    }
  }

  return rows;
}

/** Lookup of planned cells, keyed for the curve functions. */
export function distributionMap(cells: { boqItemId: string; periodId: string; plannedPct: number }[]) {
  return new Map(cells.map((cell) => [cellKey(cell.boqItemId, cell.periodId), cell.plannedPct]));
}

/**
 * The baseline S-curve.
 *
 * A cell holds the share of *its own item* planned for that period, so the
 * project-level figure for a period is Σ weight × cell / 100. The cumulative of
 * that is the curve the actual line is judged against.
 */
export function computePlannedCurve(
  rows: { leaf: LeafLike }[],
  periods: PeriodLike[],
  cells: Map<string, number>,
): { perPeriod: number[]; cumulative: number[] } {
  const perPeriod = periods.map((period) =>
    rows.reduce(
      (total, row) => total + (row.leaf.weight * (cells.get(cellKey(row.leaf.id, period.id)) ?? 0)) / 100,
      0,
    ),
  );

  let running = 0;
  const cumulative = perPeriod.map((value) => (running += value));

  return { perPeriod, cumulative };
}

/**
 * The actual S-curve.
 *
 * Three rules, each of which exists because of a way the naive version lies:
 *
 * 1. **A period with no entry carries the previous reading forward.** Readings
 *    are cumulative, so a line nobody updated this week is still as complete as
 *    it was last week — not back at zero.
 *
 * 2. **A cleared cell is not a reading of zero.** Wiping a mistaken entry
 *    leaves a row behind with both cumulative columns null; it must behave like
 *    no entry at all. An explicit zero, on the other hand, is somebody saying
 *    the work has not started, and *does* reset the line.
 *
 * 3. **The line stops at the last real reading**, rather than running flat to
 *    the data date. Trailing nulls leave a gap the chart does not draw, so an
 *    unreported period reads as unknown instead of as "no progress made".
 */
export function computeActualCurve(
  rows: { leaf: LeafLike }[],
  periods: PeriodLike[],
  entries: EntryLike[],
  dataDate: string | null,
): { cumulative: (number | null)[] } {
  const readings = new Map<string, number>();
  const periodsWithReadings = new Set<string>();

  for (const entry of entries) {
    if (entry.cumulativePercent === null && entry.cumulativeQuantity === null) continue;
    readings.set(cellKey(entry.boqItemId, entry.periodId), entry.pctComplete);
    periodsWithReadings.add(entry.periodId);
  }

  const lastRead = periods
    .filter((period) => periodsWithReadings.has(period.id))
    .reduce((latest, period) => (period.endDate > latest ? period.endDate : latest), "");

  // Running completion per leaf — this is what "carries forward".
  const running = new Map<string, number>();
  const cumulative: (number | null)[] = [];

  for (const period of periods) {
    for (const row of rows) {
      const reading = readings.get(cellKey(row.leaf.id, period.id));
      if (reading !== undefined) running.set(row.leaf.id, reading);
    }

    if (!lastRead || period.endDate > lastRead || (dataDate && period.endDate > dataDate)) {
      cumulative.push(null);
      continue;
    }

    cumulative.push(
      rows.reduce((total, row) => total + (row.leaf.weight * (running.get(row.leaf.id) ?? 0)) / 100, 0),
    );
  }

  return { cumulative };
}

/**
 * The headline figures, anchored to the last period that has an actual reading.
 *
 * Reading planned at a later period than actual is the single easiest way to
 * make a healthy project look doomed, so both are taken from the same index.
 */
export function latestPosition(
  actual: (number | null)[],
  planned: number[],
): { index: number; actual: number; planned: number; deviation: number } {
  const index = actual.reduce<number>((last, value, i) => (value !== null ? i : last), -1);
  if (index < 0) return { index, actual: 0, planned: 0, deviation: 0 };

  const actualValue = actual[index] ?? 0;
  const plannedValue = planned[index] ?? 0;

  return {
    index,
    actual: actualValue,
    planned: plannedValue,
    deviation: actualValue - plannedValue,
  };
}

/** Sum of a section's line values — or its own, when it has no lines. */
export function sectionAmount<T extends BoqItemLike & { value: number | null }>(
  section: Section<T>,
): number {
  if (section.leaves.length === 0) return section.header.value ?? 0;
  return section.leaves.reduce((total, leaf) => total + (leaf.value ?? 0), 0);
}

/** Same rollup for weight. */
export function sectionWeight<T extends BoqItemLike>(section: Section<T>): number {
  if (section.leaves.length === 0) return section.header.weight;
  return section.leaves.reduce((total, leaf) => total + leaf.weight, 0);
}

/** Total live leaf weight — what must reach 100 before a BoQ can be baselined. */
export function totalLeafWeight<T extends BoqItemLike>(items: T[]): number {
  return scheduleRows(items).reduce((total, row) => total + row.leaf.weight, 0);
}
