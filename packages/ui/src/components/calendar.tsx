"use client";

import * as React from "react";

import { Button } from "@DashboardV2/ui/components/button";
import { ChevronLeft, ChevronRight } from "@DashboardV2/ui/components/icons";
import {
  CALENDAR_WEEKS,
  DAYS_PER_WEEK,
  addDays,
  addMonths,
  clampToRange,
  firstDayOfWeek,
  isOutOfRange,
  isSameMonth,
  monthGrid,
  monthLabel,
  startOfMonth,
  todayISO,
  weekdayNames,
  type ISODate,
} from "@DashboardV2/ui/lib/calendar-date";
import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * A month grid, written here because Base UI ships no calendar or date
 * primitive (checked against 1.6.0: combobox, fieldset, number-field and
 * scroll-area are all there, nothing date-shaped). The alternative was
 * react-day-picker plus date-fns, which is ~40 kB to restyle against the token
 * set for a control that is a `<table>` and some arithmetic.
 *
 * Everything locale-dependent comes from `Intl` — month names, weekday headers,
 * and which day a week starts on, which is not cosmetic: `en-US` starts Sunday
 * and `id-ID` Monday, so a hardcoded start puts every date in the wrong column
 * for one of the app's two locales.
 *
 * Values are `"YYYY-MM-DD"` strings in and out, matching the `date` columns they
 * come from. All arithmetic lives in `lib/calendar-date.ts` and runs in UTC.
 *
 * Keyboard support is the reason to build this rather than keep a text box:
 * arrows move by day and week, PageUp/PageDown by month, Home/End to the ends of
 * the week, Enter or Space selects. One day is tabbable at a time (roving
 * tabindex), so the calendar is a single tab stop rather than forty-two.
 */

export type CalendarLabels = {
  previousMonth: string;
  nextMonth: string;
};

const DEFAULT_LABELS: CalendarLabels = {
  previousMonth: "Previous month",
  nextMonth: "Next month",
};

export function Calendar({
  value,
  onValueChange,
  min,
  max,
  locale = "en-US",
  weekStartsOn,
  labels,
  autoFocus = false,
  className,
}: {
  value?: ISODate | null;
  onValueChange?: (value: ISODate) => void;
  min?: ISODate | null;
  max?: ISODate | null;
  /** BCP-47 tag. Callers in the app pass `useLocale().intlLocale`. */
  locale?: string;
  /** 0 = Sunday … 6 = Saturday. Defaults to the locale's own week start. */
  weekStartsOn?: number;
  labels?: Partial<CalendarLabels>;
  autoFocus?: boolean;
  className?: string;
}) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const today = todayISO();
  const weekStart = weekStartsOn ?? firstDayOfWeekMemo(locale);

  // The month on screen, which is not the selection: you can page to March
  // without choosing anything, and reopening a picker should land on the chosen
  // date's month rather than wherever you last browsed.
  const [view, setView] = React.useState(() => startOfMonth(value ?? today));
  // The day the roving tabindex sits on. Starts at the selection so a keyboard
  // user arrives where the current value is, not at the top-left of the grid.
  const [focused, setFocused] = React.useState<ISODate>(() =>
    clampToRange(value ?? today, min, max),
  );
  // Only move real focus for keyboard navigation — doing it on every render
  // would steal focus from the trigger as the popup opens.
  const shouldFocus = React.useRef(autoFocus);
  const gridRef = React.useRef<HTMLTableElement>(null);

  // Follow an externally changed value, e.g. the end-date picker being reset
  // when the start date moves past it.
  //
  // Keyed off the previous `value` rather than off `view`, because this effect
  // sets `view`: reacting to `view` too made it a loop that undid every page.
  // Pressing "next month" on a field that had a date set `view` to September,
  // re-ran this, found the value still in August, and snapped straight back —
  // so prev/next and PageUp/PageDown did nothing at all once a date was chosen,
  // and `focused` was left on a day outside the grid, costing the calendar its
  // only tab stop.
  const previousValue = React.useRef(value);
  React.useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    if (value && !isSameMonth(value, view)) setView(startOfMonth(value));
  }, [value, view]);

  React.useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused]);

  const days = monthGrid(view, weekStart);
  const weekdays = weekdayNames(locale, weekStart);
  // The column shows "Mon"; `abbr` gives a screen reader "Monday" to read
  // instead. Same string in both would defeat the point of the attribute.
  const weekdaysLong = weekdayNames(locale, weekStart, "long");
  const heading = monthLabel(view, locale);
  const headingId = React.useId();
  const dayFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }),
    [locale],
  );

  function moveTo(day: ISODate) {
    const next = clampToRange(day, min, max);
    shouldFocus.current = true;
    setFocused(next);
    if (!isSameMonth(next, view)) setView(startOfMonth(next));
  }

  function goToMonth(amount: number) {
    const next = addMonths(view, amount);
    setView(startOfMonth(next));
    // Keep the roving tabindex inside the visible month, on the same day number
    // where that day exists.
    setFocused((current) => clampToRange(addMonths(current, amount), min, max));
  }

  function select(day: ISODate) {
    if (isOutOfRange(day, min, max)) return;
    onValueChange?.(day);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTableElement>) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -DAYS_PER_WEEK,
      ArrowDown: DAYS_PER_WEEK,
    };

    if (event.key in moves) {
      event.preventDefault();
      moveTo(addDays(focused, moves[event.key]!));
      return;
    }

    switch (event.key) {
      case "PageUp":
        event.preventDefault();
        goToMonth(-1);
        shouldFocus.current = true;
        break;
      case "PageDown":
        event.preventDefault();
        goToMonth(1);
        shouldFocus.current = true;
        break;
      case "Home": {
        event.preventDefault();
        // To the start of the week, which depends on where the week starts.
        const offset = (weekdayIndex(focused) - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
        moveTo(addDays(focused, -offset));
        break;
      }
      case "End": {
        event.preventDefault();
        const offset = (weekdayIndex(focused) - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
        moveTo(addDays(focused, DAYS_PER_WEEK - 1 - offset));
        break;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        select(focused);
        break;
      default:
        break;
    }
  }

  return (
    <div className={cn("w-fit space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={text.previousMonth}
          onClick={() => goToMonth(-1)}
        >
          <ChevronLeft />
        </Button>
        {/* aria-live so paging the month is announced — without it a screen
            reader user pages into silence and has to hunt for the heading. */}
        <div
          id={headingId}
          aria-live="polite"
          className="flex-1 text-center text-xs font-medium tabular-nums"
        >
          {heading}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={text.nextMonth}
          onClick={() => goToMonth(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={headingId}
        className="border-collapse"
        onKeyDown={onKeyDown}
      >
        <thead>
          <tr>
            {weekdays.map((weekday, index) => (
              <th
                key={index}
                scope="col"
                abbr={weekdaysLong[index]}
                className="size-8 pb-1 text-center text-[0.6875rem] font-normal text-muted-foreground"
              >
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: CALENDAR_WEEKS }, (_, week) => (
            <tr key={week}>
              {days.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK).map((day) => {
                const outside = !isSameMonth(day, view);
                const disabled = isOutOfRange(day, min, max);
                const selected = day === value;

                return (
                  <td key={day} className="p-0">
                    <button
                      type="button"
                      data-day={day}
                      // One tab stop for the whole grid; the arrows do the rest.
                      tabIndex={day === focused ? 0 : -1}
                      // Not `disabled`: an unfocusable cell under the roving
                      // tabindex is a hole the arrow keys fall into. aria-disabled
                      // announces it and the handler ignores it.
                      aria-disabled={disabled || undefined}
                      aria-selected={selected}
                      aria-current={day === today ? "date" : undefined}
                      aria-label={dayFormatter.format(new Date(`${day}T00:00:00Z`))}
                      data-outside={outside || undefined}
                      data-today={day === today || undefined}
                      className={cn(
                        "size-8 rounded-md text-center text-xs tabular-nums transition-colors outline-none",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        "hover:bg-muted hover:text-foreground",
                        outside && "text-muted-foreground/60",
                        day === today && !selected && "font-medium ring-1 ring-border",
                        selected &&
                          "bg-primary font-medium text-primary-foreground hover:bg-primary/80",
                        disabled &&
                          "cursor-not-allowed text-muted-foreground/40 line-through hover:bg-transparent hover:text-muted-foreground/40",
                      )}
                      onClick={() => {
                        setFocused(day);
                        select(day);
                      }}
                    >
                      {Number(day.slice(8, 10))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function weekdayIndex(day: ISODate): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** `Intl.Locale` construction is not free and the locale rarely changes. */
const weekStartCache = new Map<string, number>();
function firstDayOfWeekMemo(locale: string): number {
  const cached = weekStartCache.get(locale);
  if (cached !== undefined) return cached;
  const value = firstDayOfWeek(locale);
  weekStartCache.set(locale, value);
  return value;
}
