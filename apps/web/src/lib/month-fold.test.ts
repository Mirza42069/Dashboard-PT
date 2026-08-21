import { expect, test } from "bun:test";

import { foldCandidates, manualFolds, protectedMonths, toggleFold } from "./month-fold";
import type { MonthFoldState } from "./month-fold";
import type { PeriodLike } from "./period-header";

const PERIODS: PeriodLike[] = [
  { id: "p1", periodIndex: 1, label: "W1", startDate: "2026-05-04", endDate: "2026-05-10" },
  { id: "p2", periodIndex: 2, label: "W2", startDate: "2026-05-11", endDate: "2026-05-17" },
  { id: "p3", periodIndex: 3, label: "W3", startDate: "2026-05-18", endDate: "2026-05-24" },
  { id: "p4", periodIndex: 4, label: "W4", startDate: "2026-05-25", endDate: "2026-05-31" },
  { id: "p5", periodIndex: 5, label: "W5", startDate: "2026-06-01", endDate: "2026-06-07" },
  { id: "p6", periodIndex: 6, label: "W6", startDate: "2026-06-08", endDate: "2026-06-14" },
  { id: "p7", periodIndex: 7, label: "W7", startDate: "2026-06-15", endDate: "2026-06-21" },
  { id: "p8", periodIndex: 8, label: "W8", startDate: "2026-06-22", endDate: "2026-06-28" },
  { id: "p9", periodIndex: 9, label: "W9", startDate: "2026-06-29", endDate: "2026-07-05" },
];

const NONE: MonthFoldState = new Map();

test("pressing the chevron on an auto-folded month records an unfold, not a fold", () => {
  // The month has no stored intent — the fitter folded it. Inverting the
  // absence would store "folded" and change nothing on screen.
  const next = toggleFold(NONE, "2026-05", true);

  expect(next.get("2026-05")).toBe("unfolded");
  expect(protectedMonths(next).has("2026-05")).toBe(true);
  expect(manualFolds(next).has("2026-05")).toBe(false);
});

test("pressing the chevron on an open month folds it", () => {
  const next = toggleFold(NONE, "2026-05", false);

  expect(next.get("2026-05")).toBe("folded");
  expect(manualFolds(next).has("2026-05")).toBe(true);
});

test("toggling twice returns to the original intent", () => {
  const folded = toggleFold(NONE, "2026-05", false);
  const unfolded = toggleFold(folded, "2026-05", true);

  expect(unfolded.get("2026-05")).toBe("unfolded");
  expect(manualFolds(unfolded).size).toBe(0);
});

test("toggling does not mutate the state it was given", () => {
  const next = toggleFold(NONE, "2026-05", false);

  expect(NONE.size).toBe(0);
  expect(next.size).toBe(1);
});

test("a single-period month is never a fold candidate", () => {
  // July holds one week, so folding it would be a control that does nothing.
  expect(foldCandidates(PERIODS, NONE, null)).not.toContain("2026-07");
});

test("the month holding the data date is not a candidate", () => {
  const candidates = foldCandidates(PERIODS, NONE, "2026-06-10");

  expect(candidates).not.toContain("2026-06");
  expect(candidates).toContain("2026-05");
});

test("candidates come back furthest from the data date first", () => {
  const candidates = foldCandidates(PERIODS, NONE, "2026-05-05");

  expect(candidates[0]).toBe("2026-06");
});

test("an unfolded month is excluded from the candidates entirely", () => {
  const state = toggleFold(NONE, "2026-05", true);

  expect(foldCandidates(PERIODS, state, null)).not.toContain("2026-05");
});

test("with no data date every multi-period month is a candidate, widest first", () => {
  const candidates = foldCandidates(PERIODS, NONE, null);

  expect(candidates).toEqual(["2026-05", "2026-06"]);
});
