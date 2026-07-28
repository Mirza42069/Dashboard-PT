/**
 * Drizzle returns Postgres `numeric` columns as strings, deliberately — it will
 * not silently round a value that does not fit in a double. Every conversion
 * happens here so components never see a raw numeric string and never do their
 * own parsing.
 *
 * numeric(14,2) tops out at 999,999,999,999.99. Multiplied by 100 that is well
 * inside Number.MAX_SAFE_INTEGER, so a JS number is a safe carrier for display
 * and for the sums this dashboard does.
 */

/** Postgres numeric string (or null) -> number. Non-finite input becomes 0. */
export function toAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** number -> the string form Drizzle wants for a numeric column. */
export function toNumericString(value: number): string {
  return value.toFixed(2);
}

/** Rounds to 2dp without the floating-point drift of a naive toFixed chain. */
export function roundAmount(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Percentage of a whole. Returns null when there is no positive whole to
 * compare against, so callers can render "—" instead of a misleading 0% or a
 * division by zero.
 */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return roundAmount((part / whole) * 100);
}
