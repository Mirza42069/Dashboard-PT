/**
 * What a matrix cell will accept as you type.
 *
 * The entry grids stopped using `type="number"`, and this is what replaces the
 * one thing it was doing for them. It was doing three other things besides,
 * all of them bad in a grid:
 *
 * - Chrome and Safari draw spinner buttons over the right edge of a focused
 *   field. In a cell the fitter has squeezed to 56px that is a large share of
 *   the space a figure had to be read in.
 * - The scroll wheel changes the value of a focused number input. The grid is a
 *   scroll container, so scrolling past a cell you had just clicked silently
 *   rewrote a reading.
 * - Arrow Up and Down are consumed by the spinner, and `select()` and
 *   `selectionStart` do not work on number inputs at all — so cell-to-cell
 *   navigation and select-on-focus were not available while it stayed.
 *
 * `min`/`max`/`step` go with it. Outside a `<form>` they never validated
 * anything; they only told the browser how to draw those spinners.
 */

/**
 * Everything that could be part of a decimal, and nothing else.
 *
 * Filtering as you type rather than validating on save, because the save path
 * in both grids drops a non-finite value on the floor (`Number.isFinite`) — so
 * text that cannot be a number is text that will vanish without saying so. The
 * field refuses it instead.
 *
 * Deliberately permissive about *incomplete* input: "1." and "-" are both kept,
 * because they are what a half-typed "1.5" and "-2" look like, and a field that
 * erases them mid-keystroke cannot be typed into.
 */
export function decimalOnly(raw: string): string {
  let seenDot = false;
  let result = "";

  for (const character of raw) {
    if (character >= "0" && character <= "9") {
      result += character;
      continue;
    }
    // One decimal point, and only after something. A leading "." is left to be
    // typed as "0.".
    if (character === "." && !seenDot) {
      seenDot = true;
      result += character;
      continue;
    }
    // A minus only where it could be a sign.
    if (character === "-" && result.length === 0) result += character;
  }

  return result;
}
