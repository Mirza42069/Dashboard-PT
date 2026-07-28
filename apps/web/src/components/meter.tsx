"use client";

import { cn } from "@DashboardV2/ui/lib/utils";

import { useT } from "@/i18n/provider";

/**
 * A horizontal magnitude meter for one value against one maximum.
 *
 * Colour follows the dataviz rules: magnitude gets a single hue drawn from the
 * theme's sequential ramp (--chart-3), not a categorical palette. The overflow
 * state switches to --destructive *and* adds a written label, so the warning is
 * never carried by colour alone.
 */
export function Meter({
  value,
  max,
  label,
  className,
}: {
  value: number;
  max: number;
  label?: string;
  className?: string;
}) {
  const t = useT();
  const ratio = max > 0 ? value / max : 0;
  const isOver = max > 0 && value > max;
  // Clamped so an over-limit bar fills the track rather than overflowing it —
  // the overflow is communicated by the colour change and the label instead.
  const width = Math.min(Math.max(ratio, 0), 1) * 100;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-label={label ?? t.projects.progressMeter}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted p-[2px]"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            isOver ? "bg-destructive" : "bg-[var(--chart-3)]",
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {label !== undefined && (
        <p className="text-xs text-muted-foreground">
          {label}
          {isOver && (
            <span className="ml-1 font-medium text-destructive">
              {t.projects.over.toLowerCase()}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
