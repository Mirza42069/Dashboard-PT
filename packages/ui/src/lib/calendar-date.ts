/**
 * Date arithmetic for the calendar, over `"YYYY-MM-DD"` strings.
 *
 * Every function parses to **UTC midnight** and formats back from UTC parts.
 * That is the same rule `apps/web/src/lib/format.ts` already applies in
 * `formatDate`, and for the same reason: a `date` column holds a calendar day
 * with no time and no zone, so parsing `"2026-08-01"` as local time gives a
 * browser behind UTC the 31st of July. Keeping the whole month grid in UTC means
 * the off-by-one cannot reappear halfway through — no `new Date(y, m, d)`
 * anywhere below, and no `getMonth()`/`getDate()`, only their UTC counterparts.
 *
 * Strings in, strings out. The `Date` objects are an implementation detail that
 * never escapes, so callers cannot accidentally reintroduce a local-time
 * conversion by holding one.
 */

/** A calendar day with no time and no zone: `"2026-08-01"`. */
export type ISODate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight for an ISO day, or null if it isn't one. */
export function parseISODate(value: string | null | undefined): Date | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects the days that parse but roll over — "2026-02-31" becomes 3 March,
  // which is a different day than the caller asked for and should not validate.
  return toISODate(date) === value ? date : null;
}

export function isISODate(value: string | null | undefined): value is ISODate {
  return parseISODate(value) !== null;
}

export function toISODate(date: Date): ISODate {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, in the viewer's own zone — "today" is a local idea even here. */
export function todayISO(): ISODate {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function addDays(value: ISODate, amount: number): ISODate {
  const date = parseISODate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return toISODate(date);
}

/**
 * Clamps rather than rolling over: 31 January plus one month is 28 February,
 * not 3 March. Rolling over is how a "next month" button starts skipping
 * February.
 */
export function addMonths(value: ISODate, amount: number): ISODate {
  const date = parseISODate(value);
  if (!date) return value;

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + amount;
  const day = Math.min(
    date.getUTCDate(),
    daysInMonth(year + Math.floor(month / 12), ((month % 12) + 12) % 12),
  );

  return toISODate(new Date(Date.UTC(year, month, day)));
}

export function startOfMonth(value: ISODate): ISODate {
  const date = parseISODate(value);
  if (!date) return value;
  return toISODate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)));
}

export function isSameMonth(a: ISODate, b: ISODate): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * Whole days from `a` to `b`, signed. Both ends are UTC midnight, so there is no
 * DST hour to lose and this is exact division rather than a rounded quotient.
 *
 * The difference is exclusive: 1 August to 31 August is 30. An inclusive span in
 * days is `daysBetween(a, b) + 1`.
 */
export function daysBetween(a: ISODate, b: ISODate): number {
  const from = parseISODate(a);
  const to = parseISODate(b);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Which weekday a week starts on for a locale, as `0` (Sunday) to `6`
 * (Saturday) to match `Date.prototype.getUTCDay()`.
 *
 * This is not cosmetic: `en-US` starts on Sunday and `id-ID` on Monday, so a
 * hardcoded start puts every date in the wrong column for one of the app's two
 * locales. `getWeekInfo` is missing in Firefox, hence the fallback — Monday,
 * because that is the ISO-8601 week and the majority of the world including
 * Indonesia.
 */
export function firstDayOfWeek(locale: string): number {
  type WithWeekInfo = { getWeekInfo?: () => { firstDay: number } };
  try {
    const info = (new Intl.Locale(locale) as Intl.Locale & WithWeekInfo).getWeekInfo?.();
    // Intl reports ISO weekdays, 1 = Monday through 7 = Sunday.
    if (info) return info.firstDay === 7 ? 0 : info.firstDay;
  } catch {
    // Unparseable locale tag — fall through.
  }
  return 1;
}

/** Six weeks of days covering `month`, plus the neighbouring days that fill it. */
export const CALENDAR_WEEKS = 6;
export const DAYS_PER_WEEK = 7;

/**
 * The grid for the month `value` falls in: always 42 days, so the popup is the
 * same height in every month and stepping through them does not make the
 * calendar jump under the cursor.
 *
 * Leading and trailing days belong to the neighbouring months; the caller marks
 * them with `isSameMonth`.
 */
export function monthGrid(value: ISODate, weekStartsOn: number): ISODate[] {
  const first = parseISODate(startOfMonth(value));
  if (!first) return [];

  const offset = (first.getUTCDay() - weekStartsOn + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const start = toISODate(first);

  return Array.from({ length: CALENDAR_WEEKS * DAYS_PER_WEEK }, (_, index) =>
    addDays(start, index - offset),
  );
}

/** Weekday column headers, starting on `weekStartsOn`, in the locale's script. */
export function weekdayNames(
  locale: string,
  weekStartsOn: number,
  format: "short" | "narrow" | "long" = "short",
): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: format, timeZone: "UTC" });
  // 4 January 1970 was a Sunday, so day-of-week and offset line up from there.
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    formatter.format(new Date(Date.UTC(1970, 0, 4 + ((weekStartsOn + index) % DAYS_PER_WEEK)))),
  );
}

/** `"August 2026"` in the locale's own wording and order. */
export function monthLabel(value: ISODate, locale: string): string {
  const date = parseISODate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Clamps to an optional inclusive range, for `min`/`max` bounded pickers. */
export function clampToRange(
  value: ISODate,
  min?: ISODate | null,
  max?: ISODate | null,
): ISODate {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

export function isOutOfRange(
  value: ISODate,
  min?: ISODate | null,
  max?: ISODate | null,
): boolean {
  return Boolean((min && value < min) || (max && value > max));
}
