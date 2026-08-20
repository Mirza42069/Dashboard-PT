"use client";

import { Check, Loader2 } from "@DashboardV2/ui/components/icons";
import { cn } from "@DashboardV2/ui/lib/utils";

export type RunnerStep = {
  /** Stable key; also what the caller advances the runner to. */
  id: string;
  label: string;
  /** A step this run never entered. Counted out of the total, never drawn. */
  skipped?: boolean;
};

/**
 * A stepped progress panel for work whose stages are reported, not guessed.
 *
 * Only steps that have actually happened are drawn: the list grows as the work
 * does, and a step the run never entered simply never appears. Showing the
 * whole itinerary up front means drawing rows that may never come true, and
 * striking one through afterwards reads as a failure when nothing failed — the
 * reference workbook is recognised outright, so there is no layout for the
 * model to read and nothing went wrong.
 *
 * Skipped steps still count against the total, so the bar reaches 100% rather
 * than stalling short on a step that was never owed.
 */
export function StepRunner({
  steps,
  done,
  label,
}: {
  steps: RunnerStep[];
  done: number;
  label: string;
}) {
  const attempted = steps.filter((step) => !step.skipped).length;
  const completed = steps.filter((step, index) => !step.skipped && index < done).length;
  const percent = attempted === 0 ? 0 : Math.round((completed / attempted) * 100);
  const complete = completed >= attempted;

  // Everything reached so far, plus the one running now.
  const visible = steps
    .map((step, index) => ({ ...step, index }))
    .filter((step) => !step.skipped && step.index <= done);

  return (
    <div className="space-y-3">
      <div
        className="h-1 w-full overflow-hidden rounded-md bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div
          className={cn(
            "h-full bg-primary transition-[width] duration-500 ease-out",
            complete && "bg-success",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {visible.map((step) => {
          const running = step.index === done && !complete;
          return (
            <li key={step.id} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full",
                  running ? "bg-primary/15 text-primary" : "bg-success/15 text-success",
                )}
                aria-hidden
              >
                {running ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
              </span>
              <span className={cn(running && "text-muted-foreground")}>{step.label}</span>
            </li>
          );
        })}
      </ol>

      {/* One live region for the whole runner: announcing every row as it
          changes would read the entire list out again on each step. */}
      <p className="sr-only" role="status" aria-live="polite">
        {visible.at(-1)?.label ?? ""}
      </p>
    </div>
  );
}
