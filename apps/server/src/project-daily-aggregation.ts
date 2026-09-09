import type { PeriodRef } from "./boq-import-parse";
import type { ParsedDailyProgressSnapshot } from "./project-daily-progress";
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
): { entries: WeeklyItemProgress[]; warnings: string[] } {
  const entries: WeeklyItemProgress[] = [];
  const warnings: string[] = [];
  const latest = new Map<number, ParsedDailyProgressSnapshot>();
  for (const snapshot of snapshots) {
    const period = periods.find((candidate) =>
      snapshot.reportDate >= candidate.startDate && snapshot.reportDate <= candidate.endDate);
    if (!period) {
      warnings.push(`Daily item progress: report ${snapshot.reportDate} is outside the reporting calendar; no item progress was imported.`);
      continue;
    }
    const previous = latest.get(period.periodIndex);
    if (!previous || snapshot.reportDate > previous.reportDate) latest.set(period.periodIndex, snapshot);
  }
  const tolerance = 0.0001;
  for (const [periodIndex, snapshot] of [...latest].sort(([a], [b]) => a - b)) {
    const groups = new Map<number, typeof snapshot.items>();
    let problem: string | null = null;
    for (const item of snapshot.items) {
      if (![item.weight, item.amount, item.cumulativePercent].every(Number.isFinite) ||
        item.weight < 0 || item.cumulativePercent < 0 || item.cumulativePercent > 100 + 0.000001) {
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
      const weighted = items.reduce((sum, item) => sum + item.weight * item.cumulativePercent / 100, 0);
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
        sourceColumn: null,
        sourceValue: JSON.stringify({ reportDate: snapshot.reportDate, detailRows: items.map((item) => item.sourceRow), cumulativePercent: Math.min(100, pctComplete) }),
      });
    }
    const actual = actualSnapshots.find((candidate) => candidate.periodIndex === periodIndex);
    if (!problem && (Math.abs(totalWeight - 100) > tolerance ||
      Math.abs(total - snapshot.cumulativePercent) > tolerance ||
      (actual && Math.abs(total - actual.cumulativePercent) > tolerance))) {
      problem = "The itemized total does not reconcile with the project actual curve or baseline weights.";
    }
    // Partial item entries take precedence over aggregate curve snapshots, so a
    // period must reconcile completely before any of its cells can be imported.
    if (problem) warnings.push(`Daily item progress: period ${periodIndex}: ${problem} Daily detail was retained, but cumulative table entries were not imported.`);
    else entries.push(...pending);
  }
  return { entries, warnings };
}
