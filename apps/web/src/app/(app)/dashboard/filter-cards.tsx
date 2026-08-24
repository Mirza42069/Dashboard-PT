"use client";

import {
  ArrowUpRight,
  CalendarRange,
  CircleAlert,
  Eye,
  HardHat,
  Wallet,
  type IconProps,
} from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { cn } from "@DashboardV2/ui/lib/utils";
import Link from "next/link";

import { TickBar, type TickCategoryTone } from "@/components/tick-bar";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

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
  5: "grid-cols-2 xl:grid-cols-5",
};

/**
 * The shape every tile in the row shares, minus the element it is drawn as.
 *
 * A wide bar, not a square. Held to its column's width it stood as tall as it
 * was wide, and the head and the figure — the only two things in it — were
 * pushed to opposite edges with a hand's width of nothing between them. The
 * height is now whatever the contents need, with `min-h-28` under it so the row
 * does not shrink while the counts are still skeletons and snap back after.
 *
 * Head and body sit together at the top on a fixed gap, so every tile's label
 * and figure land on the same line across the row. The portfolio tile is the one
 * carrying a meter under its figure, which makes it the tallest and so the one
 * that sets the shared height; the rest keep their spare space at the bottom,
 * where it reads as margin rather than as a hole.
 *
 * `group` so the arrow chip can respond to the whole tile being hovered, rather
 * than only to the pointer being on the chip itself.
 */
const TILE =
  "group flex min-h-28 flex-col gap-4 rounded-xl bg-card p-4 " +
  "text-left ring-1 transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The things you can act on, as the page's filter control.
 *
 * These were a row of figures and, ten pixels below, a row of chips carrying
 * the same four words and the same four numbers. One control, not two: the card
 * states the count and pressing it narrows the list to exactly what it counted.
 *
 * Every card is a filter, deliberately — bar the first. A row where two tiles
 * are pressable and two are not looks like a mixed bag of readouts, and the
 * reader has to discover which is which by trying them. The portfolio tile is
 * the one exception and it is drawn as a link, so its arrow means what it looks
 * like it means.
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
  portfolioValue,
  completionPercent,
  summaryPending,
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
  /** The portfolio figures, which used to sit beside the list's title. */
  portfolioValue: number | undefined;
  completionPercent: number | null | undefined;
  summaryPending: boolean;
}) {
  const t = useT();
  const { moneyCompact, percent } = useFormat();

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

  return (
    <section
      // The portfolio tile is always there, so the row is never empty and the
      // count is one more than the number of filters that survived.
      className={cn("grid gap-3", COLUMNS[cards.length + 1])}
      role="group"
      aria-label={t.exceptions.title}
    >
      {/* The portfolio readout. It states the whole picture rather than one
          slice of it, so it opens the row and sends you to the whole list —
          which is the button that used to sit above that list. */}
      <Link
        href="/projects"
        aria-label={`${t.dashboard.workCompleted}. ${t.projects.allProjects}`}
        className={cn(TILE, "ring-foreground/10 hover:bg-muted/40")}
      >
        <TileHead tone="neutral" Icon={Wallet} />
        <div className="space-y-2.5">
          <p className="text-xs text-muted-foreground sm:text-sm">{t.dashboard.workCompleted}</p>

          {summaryPending ? (
            <Skeleton className="h-7 w-24" />
          ) : (
            <p className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
              {portfolioValue === undefined ? "—" : moneyCompact(portfolioValue)}
            </p>
          )}

          {summaryPending ? (
            <Skeleton className="h-5 w-full" />
          ) : (
            <span
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              role="meter"
              aria-label={t.projects.progressMeter}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={completionPercent ?? undefined}
              aria-valuetext={
                completionPercent === null || completionPercent === undefined
                  ? "—"
                  : percent(completionPercent)
              }
            >
              <TickBar value={completionPercent ?? 0} max={100} />
              <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
                {completionPercent === null || completionPercent === undefined
                  ? "—"
                  : percent(completionPercent)}
              </span>
            </span>
          )}
        </div>
      </Link>

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
              TILE,
              selected
                ? "bg-muted/60 ring-foreground/25"
                : "ring-foreground/10 hover:bg-muted/40",
            )}
          >
            <TileHead tone={tone} Icon={Icon} />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground sm:text-sm">{label}</p>

              {pending ? (
                <Skeleton className="h-7 w-12" />
              ) : (
                // The count, and the pool it came out of. This was a bar of
                // count-over-live projects, which cannot be read: the tile
                // never stated the denominator, so five lit pills out of twenty
                // meant nothing without knowing there were forty projects. The
                // bar said it in a language with no word for forty.
                <p className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
                    {count}
                  </span>
                  {live !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {interpolate(t.exceptions.ofLiveProjects, { count: live })}
                    </span>
                  )}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}

/**
 * The top line of a tile: what it is about, and that it goes somewhere.
 *
 * The arrow is drawn, never a control. On the portfolio tile the whole card is
 * already a link and a second one inside it would be invalid markup; on a
 * filter tile it is an affordance saying the card is pressable, and making it a
 * link would give one card two hit targets pointing at different places.
 *
 * The chip carries the mark's purple. It does not invert when the card is
 * pressed — the card body already retints for that, and a second signal saying
 * the same thing is one more state to keep in step for no gain.
 */
function TileHead({
  tone,
  Icon,
}: {
  tone: TickCategoryTone;
  Icon: (props: IconProps) => React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2" aria-hidden>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", CHIP[tone])}>
        <Icon className="size-4" />
      </span>
      {/* Grows and lifts a step on hover *or* keyboard focus — a tile that only
          answers the mouse leaves a keyboard user with nothing but the outline.
          Both are cancelled under a reduced-motion preference, where the colour
          change carries it on its own. */}
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          "bg-brand text-brand-foreground",
          "transition-[transform,background-color] duration-150",
          "group-hover:scale-110 group-hover:bg-brand-hover",
          "group-focus-visible:scale-110 group-focus-visible:bg-brand-hover",
          "motion-reduce:transition-none motion-reduce:group-hover:scale-100",
          "motion-reduce:group-focus-visible:scale-100",
        )}
      >
        <ArrowUpRight className="size-3.5" />
      </span>
    </div>
  );
}
