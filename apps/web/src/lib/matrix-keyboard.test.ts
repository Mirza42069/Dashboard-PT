import { describe, expect, test } from "bun:test";

import { nextMatrixCell, type NextMatrixCellInput } from "./matrix-keyboard";

/** A caret parked mid-value in the middle of a 5x5 grid. */
function press(key: string, overrides: Partial<NextMatrixCellInput> = {}) {
  return nextMatrixCell({
    row: 2,
    column: 2,
    key,
    rowCount: 5,
    columnCount: 5,
    atStart: false,
    atEnd: false,
    ...overrides,
  });
}

describe("nextMatrixCell", () => {
  test("up and down walk the column", () => {
    expect(press("ArrowUp")).toEqual({ row: 1, column: 2 });
    expect(press("ArrowDown")).toEqual({ row: 3, column: 2 });
  });

  test("Enter walks down, Shift+Enter back up", () => {
    expect(press("Enter")).toEqual({ row: 3, column: 2 });
    expect(press("Enter", { shiftKey: true })).toEqual({ row: 1, column: 2 });
  });

  test("left and right stay in the cell until the caret is at its edge", () => {
    expect(press("ArrowLeft")).toBeNull();
    expect(press("ArrowRight")).toBeNull();
    expect(press("ArrowLeft", { atStart: true })).toEqual({ row: 2, column: 1 });
    expect(press("ArrowRight", { atEnd: true })).toEqual({ row: 2, column: 3 });
  });

  test("an empty cell is at both edges at once and can leave either way", () => {
    expect(press("ArrowLeft", { atStart: true, atEnd: true })).toEqual({ row: 2, column: 1 });
    expect(press("ArrowRight", { atStart: true, atEnd: true })).toEqual({ row: 2, column: 3 });
  });

  test("the edges of the grid return null rather than wrapping", () => {
    expect(press("ArrowUp", { row: 0 })).toBeNull();
    expect(press("ArrowDown", { row: 4 })).toBeNull();
    expect(press("Enter", { row: 4 })).toBeNull();
    expect(press("ArrowLeft", { column: 0, atStart: true })).toBeNull();
    expect(press("ArrowRight", { column: 4, atEnd: true })).toBeNull();
  });

  test("Tab and everything else is left alone", () => {
    for (const key of ["Tab", "Escape", "a", "1", "Home", "End", "PageDown", " "]) {
      expect(press(key, { atStart: true, atEnd: true })).toBeNull();
    }
  });

  test("a one-cell grid has nowhere to go in any direction", () => {
    const only = { row: 0, column: 0, rowCount: 1, columnCount: 1, atStart: true, atEnd: true };
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]) {
      expect(press(key, only)).toBeNull();
    }
  });
});
