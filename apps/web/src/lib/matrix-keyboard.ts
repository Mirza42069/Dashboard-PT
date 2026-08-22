/**
 * Where a keypress in an entry grid should send the caret.
 *
 * Split out from the grids the way `matrix-fit` and `month-fold` are: this is
 * the part with rules worth testing, and the DOM work — finding the cell,
 * scrolling a virtualised row into existence — lives in the hook that calls it.
 *
 * Entering a period's readings means walking a column of lines, and until this
 * existed the only way to do that was Tab, which visits every checkbox and
 * every row button on the way past. Tab is deliberately left alone: it is how
 * you get *out* of the grid, and a grid that traps it is worse than one that
 * cannot navigate.
 */

export type NextMatrixCellInput = {
  row: number;
  column: number;
  /** `KeyboardEvent.key`. Anything not named below returns null. */
  key: string;
  shiftKey?: boolean;
  rowCount: number;
  columnCount: number;
  /**
   * Whether the caret sits at the start / end of the cell's own value.
   *
   * Left and Right move within the text first and only leave the cell from its
   * edges — the behaviour every spreadsheet has and the reason the cells had to
   * stop being `type="number"`, which reports neither.
   */
  atStart: boolean;
  atEnd: boolean;
};

export type MatrixCell = { row: number; column: number };

/**
 * The destination, or null to let the key do whatever it would have done.
 *
 * Null at the edges rather than wrapping. Wrapping would turn a held-down arrow
 * into a tour of the whole grid, and there is no reading of "down" from the last
 * line that means "back to the first".
 */
export function nextMatrixCell({
  row,
  column,
  key,
  shiftKey = false,
  rowCount,
  columnCount,
  atStart,
  atEnd,
}: NextMatrixCellInput): MatrixCell | null {
  const target = destination();
  if (target === null) return null;

  const withinGrid =
    target.row >= 0 &&
    target.row < rowCount &&
    target.column >= 0 &&
    target.column < columnCount;

  return withinGrid ? target : null;

  function destination(): MatrixCell | null {
    switch (key) {
      case "ArrowUp":
        return { row: row - 1, column };
      case "ArrowDown":
        return { row: row + 1, column };
      // Enter walks down the column, Shift+Enter back up it — the same figure
      // for the next line, which is the order readings arrive in.
      case "Enter":
        return { row: shiftKey ? row - 1 : row + 1, column };
      case "ArrowLeft":
        return atStart ? { row, column: column - 1 } : null;
      case "ArrowRight":
        return atEnd ? { row, column: column + 1 } : null;
      default:
        return null;
    }
  }
}
