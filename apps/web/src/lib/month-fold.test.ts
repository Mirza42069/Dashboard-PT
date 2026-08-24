import { expect, test } from "bun:test";

import { toggleFold } from "./month-fold";
import type { MonthFoldState } from "./month-fold";

const NONE: MonthFoldState = new Set();

test("toggling an open month folds it", () => {
  expect(toggleFold(NONE, "2026-05").has("2026-05")).toBe(true);
});

test("toggling a folded month unfolds it again", () => {
  const folded = toggleFold(NONE, "2026-05");

  expect(toggleFold(folded, "2026-05").has("2026-05")).toBe(false);
});

test("months fold independently of one another", () => {
  const state = toggleFold(toggleFold(NONE, "2026-05"), "2026-06");

  expect([...state].sort()).toEqual(["2026-05", "2026-06"]);
  expect([...toggleFold(state, "2026-05")]).toEqual(["2026-06"]);
});

test("the previous state is left alone", () => {
  const before = toggleFold(NONE, "2026-05");
  toggleFold(before, "2026-06");

  expect([...before]).toEqual(["2026-05"]);
  expect(NONE.size).toBe(0);
});
