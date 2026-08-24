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
 * How many digits a period column was measured to hold.
 *
 * The routers cap the value at 0-100 either way (`plannedPct`,
 * `cumulativePercent`), so four digits and a decimal point is all a percentage
 * can need. A fifth could only ever be precision the cell has no room to render
 * — so the field refuses it rather than accepting a figure it will then clip.
 */
export const MATRIX_MAX_DIGITS = 4;

/**
 * Everything that could be part of a decimal, and nothing else, up to
 * `maxDigits` of it.
 *
 * Filtering as you type rather than validating on save, because the save path
 * in both grids drops a non-finite value on the floor (`Number.isFinite`) — so
 * text that cannot be a number is text that will vanish without saying so. The
 * field refuses it instead.
 *
 * Deliberately permissive about *incomplete* input: "1." and "-" are both kept,
 * because they are what a half-typed "1.5" and "-2" look like, and a field that
 * erases them mid-keystroke cannot be typed into.
 *
 * The cap counts digits only — neither the point nor the sign spends any of the
 * budget, so "-99.99" is four digits and survives whole. It is a typing guard
 * and not a migration: a value already stored with more precision still renders
 * in full and can still be deleted, it just cannot be grown.
 */
export function decimalOnly(raw: string, maxDigits: number = MATRIX_MAX_DIGITS): string {
  let seenDot = false;
  let digits = 0;
  let result = "";

  for (const character of raw) {
    if (character >= "0" && character <= "9") {
      if (digits >= maxDigits) continue;
      digits++;
      result += character;
      continue;
    }
    // One decimal point, and only after something. A leading "." is left to be
    // typed as "0.".
    //
    // Refused once the digit budget is spent, too: a trailing point on a
    // full-width figure is one no fraction could ever follow, so it would sit
    // there as punctuation the field will not let you complete.
    if (character === "." && !seenDot && digits < maxDigits) {
      seenDot = true;
      result += character;
      continue;
    }
    // A minus only where it could be a sign.
    if (character === "-" && result.length === 0) result += character;
  }

  return result;
}
