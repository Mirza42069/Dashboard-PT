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
  compact = false,
  behindOnly = false,
}: {
  /** Null when the project has no baseline or nothing has been reported yet. */
  value: number | null;
  className?: string;
  /**
   * Drops the word, keeping the sign.
   *
   * For dense lists where the same word would repeat on every row. This does
   * not give up the non-colour channel the note above insists on — the leading
   * + or − states the direction in text, so greyscale and colour-deficient
   * readers still get the answer. Only the redundant second statement goes.
   */
  compact?: boolean;
  /**
   * Prints a figure only when the project is behind.
   *
   * For the dashboard's exception list, whose whole job is to point at
   * problems: a column of green "+0.4%" is a column you have to read in order
   * to discard. Ahead and on-plan collapse to an em dash — but the word is
   * still spoken, so the cell is not silent to a screen reader, and "ahead" is
   * still distinguishable from "no baseline yet".
   */
  behindOnly?: boolean;
}) {
  const t = useT();

  if (value === null) {
    return <span className={cn("text-muted-foreground", className)}>{t.common.none}</span>;
  }

  const position = deviationPosition(value);
  const isBehind = position === "behind";
  const isAhead = position === "ahead";
  const isOnTrack = position === "on_track";

  if (behindOnly && !isBehind) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        <span aria-hidden>{t.common.none}</span>
        <span className="sr-only">{isAhead ? t.progress.ahead : t.progress.onTrack}</span>
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5", className)}
      title={
        compact
          ? isBehind
            ? t.progress.behind
            : isAhead
              ? t.progress.ahead
              : t.progress.onTrack
          : undefined
      }
    >
      <span
        className={cn(
          "font-medium tabular-nums",
          isBehind && "text-destructive",
          // --success, not --chart-3. The chart ramp encodes magnitude, so
          // borrowing a step from it to mean "good" said something it does not
          // mean — and --chart-3 sits at L 0.55, which fails contrast as text on
          // the dark card.
          (isAhead || isOnTrack) && "text-success",
        )}
      >
        {formatDeviation(value)}
      </span>
      {!compact && (
        <span className="text-xs text-muted-foreground">
          {isBehind ? t.progress.behind : isAhead ? t.progress.ahead : t.progress.onTrack}
        </span>
      )}
    </span>
  );
}
