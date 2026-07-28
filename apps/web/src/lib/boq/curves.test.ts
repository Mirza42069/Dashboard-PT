import { expect, test } from "bun:test";

import {
  computeActualCurve,
  computePlannedCurve,
  distributionMap,
  latestPosition,
  scheduleRows,
  type BoqItemLike,
  type EntryLike,
  type PeriodLike,
} from "./curves";

/**
 * These cases came over from the old dashboard, where each of them was written
 * for a bug that had reached production. They are the specification for the
 * carry-forward rules — if one starts failing, the S-curve is lying about
 * something.
 */

const leaf = (id: string, weight: number) => ({ leaf: { id, weight } });
const period = (id: string, endDate: string): PeriodLike => ({ id, endDate });

const entry = (
  boqItemId: string,
  periodId: string,
  pctComplete: number,
  reading: number | null,
): EntryLike => ({
  boqItemId,
  periodId,
  pctComplete,
  cumulativePercent: reading,
  cumulativeQuantity: null,
});

const rows = [leaf("a", 100)];
const periods = [
  period("p1", "2026-01-07"),
  period("p2", "2026-01-14"),
  period("p3", "2026-01-21"),
];

test("an intermediate period with no entry carries the prior reading forward", () => {
  const entries = [entry("a", "p1", 50, 50), entry("a", "p3", 80, 80)];
  const { cumulative } = computeActualCurve(rows, periods, entries, "2026-01-21");
  expect(cumulative).toEqual([50, 50, 80]);
});

test("a cleared cell does NOT reset carry-forward", () => {
  // A cleared cell keeps its row but with both cumulative columns null. It must
  // behave like no entry at all, not like a reading of zero.
  const entries = [
    entry("a", "p1", 50, 50),
    entry("a", "p2", 0, null),
    entry("a", "p3", 80, 80),
  ];
  const { cumulative } = computeActualCurve(rows, periods, entries, "2026-01-21");
  expect(cumulative).toEqual([50, 50, 80]);
});

test("an explicit zero reading DOES reset carry-forward", () => {
  const entries = [entry("a", "p1", 50, 50), entry("a", "p2", 0, 0)];
  const { cumulative } = computeActualCurve(rows, periods, entries, "2026-01-21");
  expect(cumulative).toEqual([50, 0, null]);
});

test("the line ends at the last read period, not at the data date", () => {
  const entries = [entry("a", "p1", 50, 50), entry("a", "p3", 0, null)];
  const { cumulative } = computeActualCurve(rows, periods, entries, "2026-01-21");
  expect(cumulative).toEqual([50, null, null]);
});

test("no readings at all gives an empty line", () => {
  const { cumulative } = computeActualCurve(rows, periods, [], "2026-01-21");
  expect(cumulative).toEqual([null, null, null]);
});

test("periods after the data date are not drawn", () => {
  const entries = [entry("a", "p1", 50, 50), entry("a", "p3", 90, 90)];
  const { cumulative } = computeActualCurve(rows, periods, entries, "2026-01-14");
  expect(cumulative).toEqual([50, 50, null]);
});

test("weights combine across leaves", () => {
  const twoLeaves = [leaf("a", 60), leaf("b", 40)];
  const entries = [entry("a", "p1", 50, 50), entry("b", "p1", 100, 100)];
  const { cumulative } = computeActualCurve(twoLeaves, periods, entries, "2026-01-07");
  // 60 × 50% + 40 × 100% = 30 + 40
  expect(cumulative[0]).toBeCloseTo(70, 6);
});

test("the planned curve is the running total of weight x cell", () => {
  const cells = distributionMap([
    { boqItemId: "a", periodId: "p1", plannedPct: 25 },
    { boqItemId: "a", periodId: "p2", plannedPct: 25 },
    { boqItemId: "a", periodId: "p3", plannedPct: 50 },
  ]);

  const { perPeriod, cumulative } = computePlannedCurve(rows, periods, cells);
  expect(perPeriod).toEqual([25, 25, 50]);
  expect(cumulative).toEqual([25, 50, 100]);
});

test("a period with no planned cell contributes nothing", () => {
  const cells = distributionMap([{ boqItemId: "a", periodId: "p2", plannedPct: 40 }]);
  const { cumulative } = computePlannedCurve(rows, periods, cells);
  expect(cumulative).toEqual([0, 40, 40]);
});

test("the headline reads planned at the same period as actual", () => {
  // Actual stops at p2; planned must be read there too, not at p3.
  const actual = [10, 30, null];
  const planned = [20, 40, 100];
  const position = latestPosition(actual, planned);

  expect(position.index).toBe(1);
  expect(position.actual).toBe(30);
  expect(position.planned).toBe(40);
  expect(position.deviation).toBe(-10);
});

test("the headline is zeroed when nothing has been reported", () => {
  expect(latestPosition([null, null], [10, 20])).toMatchObject({
    index: -1,
    actual: 0,
    planned: 0,
    deviation: 0,
  });
});

test("a childless section prices itself as its own row", () => {
  const items: BoqItemLike[] = [
    { id: "s1", parentId: null, code: "1", description: "Groundworks", weight: 40, sortOrder: 1 },
    { id: "l1", parentId: "s1", code: "1.1", description: "Excavation", weight: 40, sortOrder: 1 },
    { id: "s2", parentId: null, code: "2", description: "Mobilisation", weight: 60, sortOrder: 2 },
  ];

  const built = scheduleRows(items);
  expect(built.map((row) => row.leaf.id)).toEqual(["l1", "s2"]);
});

test("nested BoQ trees expose only their deepest leaves to scheduling", () => {
  const items: BoqItemLike[] = [
    { id: "s", parentId: null, code: "1", description: "Structure", weight: 0, sortOrder: 1 },
    { id: "g", parentId: "s", code: "1.1", description: "Concrete", weight: 0, sortOrder: 1 },
    { id: "a", parentId: "g", code: "1.1.1", description: "Columns", weight: 60, sortOrder: 1 },
    { id: "b", parentId: "g", code: "1.1.2", description: "Beams", weight: 40, sortOrder: 2 },
  ];

  const built = scheduleRows(items);
  expect(built.map((row) => row.leaf.id)).toEqual(["a", "b"]);
  expect(built.map((row) => row.section)).toEqual(["Structure", "Structure"]);
});
