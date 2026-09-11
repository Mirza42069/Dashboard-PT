import { columnLetter, parseNumber, readCell, type PeriodRef } from "./boq-import-parse";
import type { DailyProgressMapping, ParsedDailyProgressSnapshot } from "./project-daily-progress";
import type { WeeklyItemProgress } from "./project-weekly-progress";

type BaselineRow = {
  row: number;
  description: string;
  weight: number | null;
  quantity: number | null;
  unitRate: number | null;
};

function matchLabel(value: string) {
  const label = value.trim().toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // The reference baseline and its daily reports use both spellings for K3.
  return label === "SMK K3" ? "SMKK K3" : label;
}

export function aggregateDailyProgress(
  rows: readonly BaselineRow[],
  snapshots: readonly ParsedDailyProgressSnapshot[],
  periods: readonly PeriodRef[],
  actualSnapshots: readonly { periodIndex: number; cumulativePercent: number }[],
  sourceMapping?: DailyProgressMapping | null,
): { entries: WeeklyItemProgress[]; warnings: string[] } {
  const entries: WeeklyItemProgress[] = [];
  const warnings: string[] = [];
  const tolerance = 0.0001;
  const latest = new Map<number, {
    snapshot: ParsedDailyProgressSnapshot;
    readingDate: string;
    basis: "cumulative" | "previous";
    derivedPreviousRows?: number[];
  }>();
  for (const snapshot of snapshots) {
    const period = periods.find((candidate) =>
      snapshot.reportDate >= candidate.startDate && snapshot.reportDate <= candidate.endDate);
    if (!period) {
      warnings.push(`Daily item progress: report ${snapshot.reportDate} is outside the reporting calendar; no item progress was imported.`);
      continue;
    }
    const previous = latest.get(period.periodIndex);
    if (!previous || snapshot.reportDate > previous.readingDate) {
      latest.set(period.periodIndex, { snapshot, readingDate: snapshot.reportDate, basis: "cumulative" });
    }
  }
  // ponytail: previous columns need a boundary date and matching S-curve total;
  // support mid-period reports when the source supplies an explicit prior as-of date.
  for (const snapshot of sourceMapping ? snapshots : []) {
    const period = periods.find((candidate) => candidate.startDate === snapshot.reportDate);
    const previousPeriod = period && periods.find((candidate) =>
      candidate.periodIndex === period.periodIndex - 1 &&
      Date.parse(snapshot.reportDate) - Date.parse(candidate.endDate) === 86_400_000);
    if (!previousPeriod) continue;
    const periodIndex = previousPeriod.periodIndex;
    const derivedPreviousRows: number[] = [];
    let problem: string | null = null;
    for (const item of snapshot.items) {
      const mapping = sourceMapping!;
      const sourceNumber = (column: number) => parseNumber(readCell(item.sourceValues[columnLetter(column)]));
      const previous = sourceNumber(mapping.previousPercent);
      // A blank alone is unknown. Explicit cumulative/current readings can
      // establish the prior value; a cumulative zero also proves prior zero.
      const recoverable = previous === null &&
        [mapping.cumulativePercent, mapping.remainingPercent].some((column) => typeof sourceNumber(column) === "number") &&
        (item.cumulativePercent === 0 || (item.currentPercent !== null &&
          Math.abs(item.previousPercent - (item.cumulativePercent - item.currentPercent)) <= tolerance));
      if ((typeof previous !== "number" && !recoverable) ||
        !Number.isFinite(item.previousPercent) || item.previousPercent < 0 || item.previousPercent > 100 ||
        !Number.isFinite(item.previousWeighted) ||
        Math.abs(item.previousWeighted - item.weight * item.previousPercent / 100) > tolerance ||
        item.previousPercent > item.cumulativePercent + tolerance) {
        problem = `Detail row ${item.sourceRow} has missing or inconsistent previous progress.`;
        break;
      }
      if (recoverable) derivedPreviousRows.push(item.sourceRow);
    }
    const actual = actualSnapshots.find((candidate) => candidate.periodIndex === periodIndex);
    if (!problem && !actual) problem = "There is no S-curve actual total to reconcile.";
    if (!problem && Math.abs(snapshot.items.reduce((sum, item) => sum + item.previousWeighted, 0) - actual!.cumulativePercent) > tolerance) {
      problem = "The previous itemized total does not reconcile with the S-curve actual total.";
    }
    if (problem) {
      warnings.push(`Daily item progress: period ${periodIndex}: ${problem} Previous-column readings from ${snapshot.sourceSheetName} were not imported.`);
      continue;
    }
    const existing = latest.get(periodIndex);
    if (existing) {
      const previousByRow = new Map(snapshot.items.map((item) => [item.sourceRow, item.previousPercent]));
      const conflict = existing.snapshot.items.some((item) => {
        const value = previousByRow.get(item.sourceRow);
        const stored = existing.basis === "previous" ? item.previousPercent : item.cumulativePercent;
        return value === undefined || value + tolerance < stored ||
          (existing.readingDate === previousPeriod.endDate && Math.abs(value - stored) > tolerance);
      });
      if (conflict) {
        warnings.push(`Daily item progress: period ${periodIndex}: previous progress on ${snapshot.sourceSheetName} conflicts with the dated reading; the previous-column reading was not imported.`);
        continue;
      }
      if (existing.readingDate === previousPeriod.endDate) continue;
    }
    latest.set(periodIndex, { snapshot, readingDate: previousPeriod.endDate, basis: "previous", derivedPreviousRows });
  }
  const previousByRow = new Map<number, number>();
  for (const [periodIndex, { snapshot, readingDate, basis, derivedPreviousRows }] of [...latest].sort(([a], [b]) => a - b)) {
    const percent = (item: ParsedDailyProgressSnapshot["items"][number]) =>
      basis === "previous" ? item.previousPercent : item.cumulativePercent;
    const groups = new Map<number, typeof snapshot.items>();
    let problem: string | null = null;
    for (const item of snapshot.items) {
      if (![item.weight, item.amount, percent(item)].every(Number.isFinite) ||
        item.weight < 0 || percent(item) < 0 || percent(item) > 100 + 0.000001) {
        problem = `Detail row ${item.sourceRow} has invalid progress or pricing.`;
        break;
      }
      let candidates: BaselineRow[] = [];
      for (const label of [item.description, item.parentDescription, item.sectionDescription]) {
        if (!label) continue;
        candidates = rows.filter((row) => matchLabel(row.description) === matchLabel(label));
        if (candidates.length > 0) break;
      }
      const row = candidates[0];
      if (candidates.length !== 1 || !row) {
        problem = `Detail row ${item.sourceRow} (${item.description}) has no unique baseline match.`;
        break;
      }
      const group = groups.get(row.row) ?? [];
      group.push(item);
      groups.set(row.row, group);
    }
    const pending: WeeklyItemProgress[] = [];
    let total = 0;
    let totalWeight = 0;
    for (const row of rows) {
      if (problem) break;
      const items = groups.get(row.row);
      if (!items || row.weight === null || !Number.isFinite(row.weight) || row.weight <= 0) {
        problem = `Baseline row ${row.row} (${row.description}) has no complete weighted detail.`;
        break;
      }
      const weight = items.reduce((sum, item) => sum + item.weight, 0);
      const amount = items.reduce((sum, item) => sum + item.amount, 0);
      const baselineAmount = row.quantity !== null && row.unitRate !== null
        ? row.quantity * row.unitRate : null;
      if (Math.abs(weight - row.weight) > tolerance ||
        (baselineAmount !== null && Math.abs(amount - baselineAmount) > Math.max(0.01, Math.abs(baselineAmount) * 0.000001))) {
        problem = `Detail weights or amounts do not reconcile with baseline row ${row.row} (${row.description}).`;
        break;
      }
      const weighted = items.reduce((sum, item) => sum + item.weight * percent(item) / 100, 0);
      const pctComplete = weighted / weight * 100;
      if (!Number.isFinite(pctComplete) || pctComplete < 0 || pctComplete > 100 + 0.000001) {
        problem = `Invalid cumulative progress for baseline row ${row.row}.`;
        break;
      }
      total += row.weight * Math.min(100, pctComplete) / 100;
      totalWeight += row.weight;
      pending.push({
        row: row.row,
        periodIndex,
        cumulativeQuantity: (row.quantity ?? 0) * Math.min(100, pctComplete) / 100,
        pctComplete: Math.min(100, pctComplete),
        sourceSheetName: snapshot.sourceSheetName,
        sourceRow: items[0]!.sourceRow,
        sourceColumn: sourceMapping
          ? (basis === "previous" ? sourceMapping.previousPercent : sourceMapping.cumulativePercent)
          : null,
        sourceValue: JSON.stringify({
          reportDate: snapshot.reportDate, readingDate, basis,
          detailRows: items.map((item) => item.sourceRow),
          derivedPreviousRows: derivedPreviousRows?.filter((sourceRow) => items.some((item) => item.sourceRow === sourceRow)),
          cumulativePercent: Math.min(100, pctComplete),
        }),
      });
    }
    const actual = actualSnapshots.find((candidate) => candidate.periodIndex === periodIndex);
    const sourceTotal = basis === "previous"
      ? snapshot.items.reduce((sum, item) => sum + item.previousWeighted, 0)
      : snapshot.cumulativePercent;
    if (!problem && (Math.abs(totalWeight - 100) > tolerance ||
      Math.abs(total - sourceTotal) > tolerance ||
      (actual && Math.abs(total - actual.cumulativePercent) > tolerance))) {
      problem = "The itemized total does not reconcile with the project actual curve or baseline weights.";
    }
    if (!problem && pending.some((entry) => entry.pctComplete + tolerance < (previousByRow.get(entry.row) ?? 0))) {
      problem = "Item progress decreases from an earlier imported period.";
    }
    // Partial item entries take precedence over aggregate curve snapshots, so a
    // period must reconcile completely before any of its cells can be imported.
    if (problem) warnings.push(`Daily item progress: period ${periodIndex}: ${problem} Daily detail was retained, but cumulative table entries were not imported.`);
    else {
      entries.push(...pending);
      for (const entry of pending) previousByRow.set(entry.row, entry.pctComplete);
    }
  }
  return { entries, warnings };
}
