"use client";

import { deviationPosition } from "@DashboardV2/api/lib/deviation";
import { cn } from "@DashboardV2/ui/lib/utils";

import { useT } from "@/i18n/provider";

/**
 * How far a project is from its baseline: actual − planned, in percentage
 * points. Negative is behind.
 *
 * The sign, the number and a word all say the same thing, because colour alone
 * cannot — the same rule the status badges and meters follow. Someone reading
 * this in greyscale, or with a red/green colour deficiency, still gets the
 * answer from the text.
 */
export function formatDeviation(value: number) {
  const position = deviationPosition(value);
  const displayed = position === "on_track" ? 0 : value;
  return `${displayed >= 0 ? "+" : "−"}${Math.abs(displayed).toFixed(1)}%`;
}

export function DeviationBadge({
  value,
  className,
}: {
  /** Null when the project has no baseline or nothing has been reported yet. */
  value: number | null;
  className?: string;
}) {
  const t = useT();

  if (value === null) {
    return <span className={cn("text-muted-foreground", className)}>{t.common.none}</span>;
  }

  const position = deviationPosition(value);
  const isBehind = position === "behind";
  const isAhead = position === "ahead";

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span
        className={cn(
          "font-medium tabular-nums",
          isBehind && "text-destructive",
          // --success, not --chart-3. The chart ramp encodes magnitude, so
          // borrowing a step from it to mean "good" said something it does not
          // mean — and --chart-3 sits at L 0.55, which fails contrast as text on
          // the dark card.
          isAhead && "text-success",
        )}
      >
        {formatDeviation(value)}
      </span>
      <span className="text-xs text-muted-foreground">
        {isBehind ? t.progress.behind : isAhead ? t.progress.ahead : t.progress.onTrack}
      </span>
    </span>
  );
}
