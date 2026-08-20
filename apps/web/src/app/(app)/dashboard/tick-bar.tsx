"use client";

import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * How many pills the track is drawn from.
 *
 * Twenty reads as a bar with texture. Many more and the pills merge into a
 * solid rule; many fewer and the eye starts counting them, comparing counts
 * instead of taking in the proportion.
 */
const TICKS = 20;

export type TickTone = "late" | "waiting" | "settled" | "neutral";

const FILL: Record<TickTone, string> = {
  late: "bg-destructive",
  // The mark's purple. Not a hazard colour by convention, but these are the
  // states that need a person rather than the ones that are going wrong, and
  // reserving red for the latter is what keeps red meaning something.
  waiting: "bg-brand",
  settled: "bg-success",
  neutral: "bg-[var(--chart-3)]",
};

/**
 * A proportion, drawn as a run of pills.
 *
 * One bar idiom for the whole screen: a solid track in one place and a
 * segmented meter in another read as two different kinds of measurement, and
 * they are the same kind.
 *
 * The unfilled pills are always drawn. A card whose value is zero showing no
 * bar at all reads as broken rather than as zero, and a row of cards can only
 * be compared at a glance if every one of them has the thing being compared.
 */
export function TickBar({
  value,
  max,
  tone = "neutral",
  className,
}: {
  value: number;
  /** Zero renders an empty track rather than dividing by it. */
  max: number;
  tone?: TickTone;
  className?: string;
}) {
  // Clamped both ends before it ever becomes an array length. A non-zero value
  // always shows at least one pill — one project out of forty is not nothing,
  // and rounding it away is the one error this bar must not make.
  const share = max > 0 && value > 0 ? value / max : 0;
  const filled = share <= 0 ? 0 : Math.min(TICKS, Math.max(1, Math.round(share * TICKS)));

  return (
    // One height *and* one width everywhere: the pills are a fixed size and the
    // bar is as wide as they add up to, rather than stretching to whatever
    // container it lands in. Stretching is what broke this — the same twenty
    // ticks came out as fat pills in a filter card, half that in the card
    // header and 2px slivers in a list row, so one component drew three
    // different-looking bars. Shrinking is still allowed, so a container
    // narrower than the bar thins the pills instead of overflowing.
    <span className={cn("inline-flex h-4 w-fit items-stretch gap-0.5", className)} aria-hidden>
      {Array.from({ length: TICKS }, (_, index) => (
        <span
          key={index}
          className={cn(
            "w-1.5 rounded-full",
            index < filled ? FILL[tone] : "bg-muted-foreground/20",
          )}
        />
      ))}
    </span>
  );
}
