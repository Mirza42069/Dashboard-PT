import { describe, expect, test } from "bun:test";

import {
  getFullMatrixWindow,
  getMatrixWindow,
  getVariableAnchor,
  getVariableItemOffset,
  getVariableWindowRange,
  getWindowRange,
} from "./matrix-window";

describe("matrix window ranges", () => {
  test("includes overscan and reports spacer sizes", () => {
    expect(
      getWindowRange({
        count: 100,
        itemSize: 40,
        startOffset: 400,
        endOffset: 800,
        overscan: 2,
        limit: 24,
      }),
    ).toEqual({ start: 8, end: 22, beforeSize: 320, afterSize: 3120 });
  });

  test("keeps a full bounded window at the end", () => {
    expect(
      getWindowRange({
        count: 50,
        itemSize: 10,
        startOffset: 490,
        endOffset: 510,
        overscan: 2,
        limit: 8,
      }),
    ).toEqual({ start: 42, end: 50, beforeSize: 420, afterSize: 0 });
  });

  test("never renders more than the configured limit", () => {
    const range = getWindowRange({
      count: 200,
      itemSize: 10,
      startOffset: 100,
      endOffset: 1000,
      overscan: 4,
      limit: 24,
    });

    expect(range.end - range.start).toBe(24);
  });

  test("uses measured row sizes for window offsets and spacers", () => {
    expect(
      getVariableWindowRange({
        count: 6,
        estimatedItemSize: 40,
        itemSizes: new Map([
          [0, 60],
          [1, 60],
          [2, 90],
          [3, 60],
        ]),
        startOffset: 125,
        endOffset: 250,
        overscan: 0,
        limit: 4,
      }),
    ).toEqual({ start: 2, end: 4, beforeSize: 120, afterSize: 120 });
  });

  test("uses the measured median for rows that have not rendered yet", () => {
    const range = getVariableWindowRange({
      count: 10,
      estimatedItemSize: 40,
      itemSizes: new Map([
        [0, 64],
        [1, 64],
        [2, 96],
      ]),
      startOffset: 0,
      endOffset: 64,
      overscan: 0,
      limit: 4,
    });

    expect(range.afterSize).toBe(7 * 64 + 96 + 64);
  });

  test("preserves a deep row anchor when the measured estimate evolves", () => {
    const count = 100;
    const estimatedItemSize = 40;
    const oldSizes = new Map<number, number>();
    const oldScrollOffset = 2017;
    const anchor = getVariableAnchor({
      count,
      estimatedItemSize,
      itemSizes: oldSizes,
      offset: oldScrollOffset,
    });
    const measuredSizes = new Map<number, number>(
      Array.from({ length: 10 }, (_, index) => [index + 46, 80]),
    );
    const newAnchorOffset = getVariableItemOffset({
      count,
      estimatedItemSize,
      itemSizes: measuredSizes,
      index: anchor.index,
    });
    const compensatedOffset = oldScrollOffset + newAnchorOffset - anchor.startOffset;
    const compensatedAnchor = getVariableAnchor({
      count,
      estimatedItemSize,
      itemSizes: measuredSizes,
      offset: compensatedOffset,
    });

    expect(anchor).toEqual({ index: 50, startOffset: 2000 });
    expect(compensatedAnchor.index).toBe(anchor.index);
    expect(compensatedOffset - compensatedAnchor.startOffset).toBe(17);
  });

  test("full mode returns every row and column without spacers", () => {
    expect(getFullMatrixWindow(150, 80)).toEqual({
      rows: { start: 0, end: 150, beforeSize: 0, afterSize: 0 },
      columns: { start: 0, end: 80, beforeSize: 0, afterSize: 0 },
    });
  });

  test("accounts for headers and sticky leading columns on both axes", () => {
    const window = getMatrixWindow({
      rowCount: 100,
      columnCount: 80,
      rowHeight: 40,
      columnWidth: 80,
      headerHeight: 80,
      leadingWidth: 640,
      stickyLeadingWidth: 40,
      scrollTop: 480,
      scrollLeft: 1000,
      viewportHeight: 400,
      viewportWidth: 1200,
      rowOverscan: 2,
      columnOverscan: 1,
      rowLimit: 24,
      columnLimit: 24,
    });

    expect(window.rows.start).toBe(8);
    expect(window.columns.start).toBe(4);
    expect(window.rows.end - window.rows.start).toBeLessThanOrEqual(24);
    expect(window.columns.end - window.columns.start).toBeLessThanOrEqual(24);
  });

  test("returns empty ranges for empty dimensions", () => {
    const window = getMatrixWindow({
      rowCount: 0,
      columnCount: 0,
      rowHeight: 40,
      columnWidth: 80,
      headerHeight: 80,
      leadingWidth: 300,
      stickyLeadingWidth: 300,
      scrollTop: 0,
      scrollLeft: 0,
      viewportHeight: 500,
      viewportWidth: 1000,
      rowOverscan: 2,
      columnOverscan: 2,
      rowLimit: 24,
      columnLimit: 24,
    });

    expect(window.rows).toEqual({ start: 0, end: 0, beforeSize: 0, afterSize: 0 });
    expect(window.columns).toEqual({ start: 0, end: 0, beforeSize: 0, afterSize: 0 });
  });
});
