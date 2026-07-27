"use client";

import { cn } from "@DashboardV2/ui/lib/utils";

import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

/**
 * A horizontal magnitude meter — the right form for "how much of the budget is
 * gone", where there is one value against one maximum.
 *
 * Colour follows the dataviz rules: magnitude gets a single hue drawn from the
 * theme's sequential ramp (--chart-3), not a categorical palette. The over-budget
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
  // Clamped so an over-budget bar fills the track rather than overflowing it —
  // the overflow is communicated by the colour change and the label instead.
  const width = Math.min(Math.max(ratio, 0), 1) * 100;

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-label={label ?? t.projects.budgetUsed}
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
              {t.projects.overBudgetNote.toLowerCase()}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/** Budget meter with the standard "spent of budget · N%" caption. */
export function BudgetMeter({
  spent,
  budget,
  className,
}: {
  spent: number;
  budget: number;
  className?: string;
}) {
  const { money, percent } = useFormat();
  const used = budget > 0 ? (spent / budget) * 100 : null;

  return (
    <Meter
      value={spent}
      max={budget}
      className={className}
      label={
        budget > 0
          ? `${money(spent)} / ${money(budget)} · ${percent(used)}`
          : money(spent)
      }
    />
  );
}
