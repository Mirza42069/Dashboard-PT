"use client";

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
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
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

  // A fraction of a percent either way is rounding, not a schedule position.
  const isBehind = value <= -0.05;
  const isAhead = value >= 0.05;

  return (
    <span className={cn("inline-flex items-baseline gap-1.5", className)}>
      <span
        className={cn(
          "font-medium tabular-nums",
          isBehind && "text-destructive",
          isAhead && "text-[var(--chart-3)]",
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
