"use client";

import { useCallback, type KeyboardEvent, type RefObject } from "react";

import { nextMatrixCell } from "./matrix-keyboard";

/** The attribute a cell input carries so the handler can find its neighbours. */
const CELL_ATTRIBUTE = "data-matrix-cell";

/**
 * Arrow-key and Enter navigation between the cells of an entry grid.
 *
 * One handler on the scroll container rather than one per input: the grids
 * render hundreds of cells, and the rules are the same for every one of them.
 * `nextMatrixCell` in ./matrix-keyboard.ts decides where to go; everything here
 * is the part that has to touch the DOM.
 */
export function useMatrixKeyboard({
  scrollRef,
  rowCount,
  columnCount,
  rowHeight,
  columnWidth,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  rowCount: number;
  columnCount: number;
  /** Used to nudge a virtualised row into existence. The estimate is enough. */
  rowHeight: number;
  /** Used to nudge a virtualised column into existence. */
  columnWidth: number;
}) {
  /**
   * The props a cell input needs to take part. Spread onto the `Input`.
   *
   * `row` is the index within the whole grid, not within the rendered window —
   * navigation has to survive scrolling, and a window-relative index stops
   * meaning anything the moment the window moves.
   */
  const cellProps = useCallback(
    (row: number, column: number) => ({ [CELL_ATTRIBUTE]: `${row}:${column}` }),
    [],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const container = scrollRef.current;
      const source = event.target;
      if (!container || !(source instanceof HTMLInputElement)) return;

      const coordinates = source.getAttribute(CELL_ATTRIBUTE);
      if (coordinates === null) return;

      const [row, column] = coordinates.split(":").map(Number);
      if (!Number.isInteger(row) || !Number.isInteger(column)) return;

      // Selection is null on inputs that do not support it. Treating that as
      // "at both edges" would make Left and Right jump cells mid-word, so the
      // safer reading is "not at an edge" and those keys stay put.
      const caret = source.selectionStart;
      const caretEnd = source.selectionEnd;
      const target = nextMatrixCell({
        row: row as number,
        column: column as number,
        key: event.key,
        shiftKey: event.shiftKey,
        rowCount,
        columnCount,
        atStart: caret === 0 && caretEnd === 0,
        atEnd: caret === source.value.length && caretEnd === source.value.length,
      });

      if (target === null) return;

      // Only now — a key we are not acting on must keep its default, or Enter
      // stops submitting and Tab stops leaving the grid.
      event.preventDefault();

      const columnStep = Math.sign(target.column - (column as number));
      if (focusCell(container, target.row, target.column, columnStep, columnCount)) return;

      /*
       * Nothing there — the row is outside the virtualised window, so its input
       * does not exist yet. Scroll toward it and try again once the window has
       * re-rendered around the new offset.
       *
       * Without this the grid simply stops navigating partway down a long BoQ,
       * which looks like the feature breaking rather than like a limit.
       */
      const rowStep = target.row - (row as number);
      container.scrollTop += rowStep * rowHeight;
      container.scrollLeft += columnStep * columnWidth;
      requestAnimationFrame(() => {
        focusCell(container, target.row, target.column, columnStep, columnCount);
      });
    },
    [scrollRef, rowCount, columnCount, rowHeight, columnWidth],
  );

  return { cellProps, onKeyDown };
}

/**
 * Focus the cell at these coordinates, selecting whatever it already holds so
 * typing replaces the reading rather than appending to it.
 *
 * A horizontal move steps past columns that hold no input — a folded month, or
 * a period whose report is submitted and no longer editable. Landing on one and
 * stopping would make the arrow key look broken on exactly the grids where
 * folding is most common. Vertical moves do not need this: editability is a
 * property of the period, so a column is editable for every row or for none.
 */
function focusCell(
  container: HTMLElement,
  row: number,
  column: number,
  columnStep: number,
  columnCount: number,
): boolean {
  for (
    let candidate = column;
    candidate >= 0 && candidate < columnCount;
    candidate += columnStep
  ) {
    const input = container.querySelector<HTMLInputElement>(
      `[${CELL_ATTRIBUTE}="${row}:${candidate}"]`,
    );
    if (input) {
      input.focus();
      input.select();
      return true;
    }
    if (columnStep === 0) break;
  }
  return false;
}
