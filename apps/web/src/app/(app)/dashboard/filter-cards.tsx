"use client";

import {
  CalendarRange,
  CircleAlert,
  Eye,
  HardHat,
  type IconProps,
} from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { cn } from "@DashboardV2/ui/lib/utils";

import { TickBar, type TickCategoryTone } from "@/components/tick-bar";
import { useT } from "@/i18n/provider";

import type { AttentionFilter } from "./attention-list";

type FilterKey = Exclude<AttentionFilter, "all">;

const ICON: Record<FilterKey, (props: IconProps) => React.ReactNode> = {
  behind: HardHat,
  reporting: CalendarRange,
  review: Eye,
  actions: CircleAlert,
};

/**
 * Each card's colour is the severity of the thing it counts, so the row reads
 * left-to-right as most to least urgent even before the numbers are.
 */
const TONE: Record<FilterKey, TickCategoryTone> = {
  behind: "late",
  reporting: "waiting",
  review: "waiting",
  actions: "neutral",
};

// Glyphs on a tinted chip, not text, so each can take its full-strength colour
// rather than the darker value a text-contrast rule would force.
const CHIP: Record<TickCategoryTone, string> = {
  late: "bg-destructive/12 text-destructive",
  waiting: "bg-brand/12 text-brand",
  settled: "bg-success/12 text-success",
  neutral: "bg-[var(--chart-1)]/12 text-[var(--chart-1)]",
};

/**
 * As many columns as there are cards.
 *
 * A card that hides itself out of a fixed four-column grid leaves the hole it
 * used to fill, which reads as something failing to load rather than as
 * something being fine. The row closes up instead.
 *
 * Written out rather than built from a template string because Tailwind scans
 * for whole class names, and `xl:grid-cols-${n}` is not one.
 */
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2 xl:grid-cols-2",
  3: "grid-cols-2 xl:grid-cols-3",
  4: "grid-cols-2 xl:grid-cols-4",
};

/**
 * The things you can act on, as the page's filter control.
 *
 * These were a row of figures and, ten pixels below, a row of chips carrying
 * the same four words and the same four numbers. One control, not two: the card
 * states the count and pressing it narrows the list to exactly what it counted.
 *
 * Every card is a filter, deliberately. A row where two tiles are pressable and
 * two are not looks like a mixed bag of readouts, and the reader has to
 * discover which is which by trying them.
 *
 * And a card counting nothing is not a filter at all — the one thing pressing
 * it can do is empty the list below. "Awaiting review 0" beside an empty meter
 * is a permanent invitation to a dead end, so a count of zero takes the card
 * off the row and the row narrows to what is left. Nothing is lost: the whole
 * portfolio is one press of an active card away, and the list underneath says
 * "Nothing needs attention" when every count is zero.
 */
export function FilterCards({
  counts,
  live,
  active,
  onSelect,
  canReview,
  pending,
}: {
  counts:
    | { behind: number; reporting: number; awaitingReview: number; openTickets: number }
    | undefined;
  /** The denominator: live projects. Shared by every card so the bars compare. */
  live: number | undefined;
  active: AttentionFilter;
  onSelect: (filter: AttentionFilter) => void;
  canReview: boolean;
  pending: boolean;
}) {
  const t = useT();

  const cards = (
    [
      ["behind", t.exceptions.behind, counts?.behind ?? 0],
      ["reporting", t.exceptions.reportingProblems, counts?.reporting ?? 0],
      ["review", t.exceptions.awaitingReview, counts?.awaitingReview ?? 0],
      ["actions", t.exceptions.openIssues, counts?.openTickets ?? 0],
    ] as const
  )
    .filter(([key]) => key !== "review" || canReview)
    .filter(
      ([key, , count]) =>
        // While the counts are still loading every one of them reads zero, and
        // a row that empties itself and then fills back in is worse than four
        // skeletons that were always going to be there.
        pending ||
        count > 0 ||
        // The pressed card stays whatever it counts. Reviewing the last report
        // in the filter takes its count to zero, and a filter that removes its
        // own way out strands the reader on an empty list.
        active === key,
    );

  if (cards.length === 0) return null;

  return (
    <section
      className={cn("grid gap-3", COLUMNS[cards.length])}
      role="group"
      aria-label={t.exceptions.title}
    >
      {cards.map(([key, label, count]) => {
        const selected = active === key;
        const tone = TONE[key];
        const Icon = ICON[key];

        return (
          // A button styled as a card rather than a card wrapping one: Card is a
          // plain div, and nesting the control inside it would leave the card's
          // own padding outside the hit area.
          <button
            key={key}
            type="button"
            aria-pressed={selected}
            // Pressing the active card clears back to everything — otherwise the
            // only way out of a filter is to find whichever one was on before.
            onClick={() => onSelect(selected ? "all" : key)}
            className={cn(
              "flex flex-col gap-3 rounded-lg bg-card p-3 text-left ring-1 transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected
                ? "bg-muted/60 ring-foreground/25"
                : "ring-foreground/10 hover:bg-muted/40",
            )}
          >
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 sm:gap-2.5">
                <span
                  className={cn("grid size-8 shrink-0 place-items-center rounded-lg", CHIP[tone])}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="text-xs text-muted-foreground sm:text-sm">{label}</span>
              </div>

              {pending ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                <p className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                  {count}
                </p>
              )}

              <TickBar value={count} max={live ?? 0} tone={tone} />
            </div>
          </button>
        );
      })}
    </section>
  );
}
