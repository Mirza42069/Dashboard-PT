"use client";

import { ChevronDown, ChevronRight } from "@DashboardV2/ui/components/icons";
import { cn } from "@DashboardV2/ui/lib/utils";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import type { MonthBand, PeriodHeaderModel, PeriodLike } from "@/lib/period-header";

/**
 * The rules inside a grid header, as inset shadows rather than borders.
 *
 * The grids that draw this row stick their `<thead>`, and the tables are
 * `border-collapse: collapse` — under which a border belongs to the *table*, not
 * to the cell that declared it, so it stays behind when the header translates.
 * The header ends up ruleless and a stray line floats in the body. A shadow is
 * painted by the cell itself, so it travels.
 *
 * `border-separate` would fix the same thing and cannot be used here: in the
 * separate-borders model a `<tr>` may not have a border at all, which would
 * delete every row divider in the grid below.
 *
 * Exported because the windowed band row and the period header row in the grids
 * themselves have to draw the identical rule — see components/matrix-window.tsx.
 */
export const HEADER_RULE = "shadow-[inset_0_-1px_0_var(--border)]";

/**
 * The month band that runs above a schedule grid's period columns.
 *
 * A separate header row whose cells span their run of periods, exactly as the
 * source workbooks draw it: MEI over four weeks, JUNI over five. It is the one
 * piece of structure that makes a seventeen-column grid legible at a glance,
 * and it earns the row it occupies because it encodes something true — which
 * calendar month each column of work falls in — rather than decorating.
 *
 * Shared between the schedule and progress grids so a period cannot sit under
 * June on one tab and May on the other.
 *
 * Each band is also the control that folds its own month. Putting the control
 * anywhere else would need a second row explaining which month it applied to;
 * here the thing you press *is* the run it collapses.
 */
export function MonthBandRow<P extends PeriodLike>({
  header,
  /** Accessible name for the corner cell above the identity columns. */
  leadingLabel,
  /** How many columns precede the periods — identity, planning controls. */
  leadingColSpan = 1,
  /** How many follow them, e.g. a row total and a row menu. */
  trailingColSpan = 0,
  /** Omitted where a grid does not offer folding; the bands render as plain text. */
  onToggleMonth,
  /** The id of the grid the control expands, for aria-controls. */
  gridId,
}: {
  header: PeriodHeaderModel<P>;
  leadingLabel: string;
  leadingColSpan?: number;
  trailingColSpan?: number;
  onToggleMonth?: (monthKey: string) => void;
  gridId?: string;
}) {
  if (header.months.length === 0) return null;

  return (
    // No `border-b` on the row: see HEADER_RULE above.
    <tr>
      <th
        scope="col"
        colSpan={leadingColSpan}
        className={`sticky left-0 z-30 bg-card px-4 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground ${HEADER_RULE}`}
      >
        <span className="sr-only">{leadingLabel}</span>
      </th>
      {header.months.map((month) => (
        <MonthBandCell
          key={month.monthKey}
          month={month}
          onToggleMonth={onToggleMonth}
          gridId={gridId}
        />
      ))}
      {trailingColSpan > 0 && (
        <th aria-hidden colSpan={trailingColSpan} className={`bg-card ${HEADER_RULE}`} />
      )}
    </tr>
  );
}

/**
 * One month's cell, with or without its fold control.
 *
 * Exported so the windowed variant in matrix-window.tsx draws the identical
 * cell — the two band rows differ only in the spacer columns either side of
 * them, and duplicating the button was how they last drifted apart.
 */
export function MonthBandCell({
  month,
  onToggleMonth,
  gridId,
}: {
  month: MonthBand;
  onToggleMonth?: (monthKey: string) => void;
  gridId?: string;
}) {
  const t = useT();
  const interactive = onToggleMonth !== undefined && month.foldable;
  const Chevron = month.collapsed ? ChevronRight : ChevronDown;

  return (
    <th
      scope="colgroup"
      colSpan={month.span}
      // Centred over its run and ruled off from the next month, which is
      // what makes the grouping readable without a background per month.
      //
      // Opaque, and ruled with a shadow rather than a border, because the grids
      // stick this row — see HEADER_RULE. A transparent header cell lets the
      // body scroll through it, which is what it used to do.
      //
      // The two shadows are written out rather than composed from HEADER_RULE:
      // Tailwind scans source text for class names, so a variant assembled at
      // runtime is one it never generates.
      className={cn(
        "bg-card px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground",
        "shadow-[inset_0_-1px_0_var(--border),inset_1px_0_0_var(--border)]",
        "first:shadow-[inset_0_-1px_0_var(--border)]",
      )}
    >
      {interactive ? (
        <button
          type="button"
          onClick={() => onToggleMonth(month.monthKey)}
          aria-expanded={!month.collapsed}
          aria-controls={gridId}
          aria-label={interpolate(
            month.collapsed ? t.progress.expandMonth : t.progress.collapseMonth,
            { month: month.label },
          )}
          className={cn(
            "inline-flex w-full items-center justify-center gap-0.5 rounded-sm px-1 uppercase",
            "hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          )}
        >
          {month.label}
          <Chevron className="size-3 shrink-0" aria-hidden />
        </button>
      ) : (
        month.label
      )}
    </th>
  );
}
