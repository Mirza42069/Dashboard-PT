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
 *
 * Drawn as discrete rectangular segments rather than one continuous pill. The
 * blocks are a reading aid — ten of them means a glance lands on "about six
 * tenths" without going to the number underneath — and the square corners are
 * what make them read as separate cells instead of one bar with notches cut in.
 */
const SEGMENTS = 10;

export function Meter({
  value,
  max,
  label,
  ariaLabel,
  segments = SEGMENTS,
  tone = "default",
  className,
}: {
  value: number;
  max: number;
  label?: string;
  /** Accessible context when several meters appear together. */
  ariaLabel?: string;
  /** Lower this where the meter sits in a narrow column. */
  segments?: number;
  /** Semantic status when this meter represents more than neutral magnitude. */
  tone?: "default" | "success" | "destructive";
  className?: string;
}) {
  const t = useT();
  const ratio = max > 0 ? value / max : 0;
  const isOver = max > 0 && value > max;
  // Clamped so an over-limit bar fills the track rather than overflowing it —
  // the overflow is communicated by the colour change and the label instead.
  const filled = Math.min(Math.max(ratio, 0), 1) * segments;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-label={ariaLabel ?? label ?? t.projects.progressMeter}
        // The segments are decoration over a value the meter role already
        // reports, so nothing inside here is exposed separately — a screen
        // reader announcing ten cells would be ten times the noise for the same
        // one number.
        className="flex h-2 w-full gap-[2px]"
      >
        {Array.from({ length: segments }, (_, index) => (
          <div key={index} aria-hidden className="h-full flex-1 overflow-hidden bg-muted">
            {/*
             * The boundary segment fills *partially* rather than rounding to a
             * whole block. Rounding is the obvious implementation and it lies at
             * both ends of the scale: at 96% every cell would be lit and the bar
             * would read as finished, and at 4% none would be lit and it would
             * read as not started. A part-filled cell keeps the meter an honest
             * readout of the number beneath it while still reading as blocks.
             */}
            <div
              className={cn(
                "h-full transition-[width] duration-300",
                isOver || tone === "destructive"
                  ? "bg-destructive"
                  : tone === "success"
                    ? "bg-success"
                    : "bg-[var(--chart-3)]",
              )}
              style={{ width: `${Math.min(Math.max(filled - index, 0), 1) * 100}%` }}
            />
          </div>
        ))}
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
