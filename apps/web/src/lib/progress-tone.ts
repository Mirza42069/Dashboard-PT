/**
 * Which colour a progress bar is drawn in, from the one number it is drawing.
 *
 * Both bar primitives used to hardcode a single step of the chart ramp, so
 * every bar in the product came out the same blue no matter what it said. A
 * list of ten projects at ten different completions looked like ten identical
 * bars, and the figure printed beside each one was doing all the work.
 *
 * Bands rather than a continuous gradient. A gradient would make two projects
 * four points apart look different for no reason a reader could act on; bands
 * make "barely started" and "nearly done" tell apart at a glance and say
 * nothing finer than that. The number is still there for anyone who needs it.
 *
 * Being behind schedule is *not* one of these. That is a different question —
 * where you are against where you said you would be, not how far along you are
 * — and it overrides at the call site with the destructive tone, which is what
 * keeps red meaning trouble rather than meaning "not much yet".
 */
export type ProgressBand = 1 | 2 | 3 | 4 | 5;

/**
 * Percent complete → band.
 *
 * 100 gets a band to itself. A finished bar reading the same as one at 97%
 * loses the only distinction in the scale anybody asks about, and the boundary
 * is exact rather than rounded for the same reason: 99.6% is not done.
 */
export function progressBand(percent: number): ProgressBand {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  if (clamped >= 100) return 5;
  if (clamped > 75) return 4;
  if (clamped > 50) return 3;
  if (clamped > 25) return 2;
  return 1;
}

/**
 * The fill class per band.
 *
 * Convention elsewhere (see dashboard/severity.ts) is that a shared module
 * decides the level and each component keeps its own paint table, because two
 * components can legitimately want to paint the same level differently. Not
 * here: tick-bar.tsx sets out why the app has one bar idiom for the whole
 * product, and two bars drawing the same measurement in different colours is
 * the thing that rule exists to prevent. So the table lives with the band.
 */
export const PROGRESS_FILL: Record<ProgressBand, string> = {
  1: "bg-[var(--progress-1)]",
  2: "bg-[var(--progress-2)]",
  3: "bg-[var(--progress-3)]",
  4: "bg-[var(--progress-4)]",
  5: "bg-[var(--progress-5)]",
};

/** The fill for a value against a maximum, guarding a zero or absent maximum. */
export function progressFill(value: number, max: number): string {
  return PROGRESS_FILL[progressBand(max > 0 ? (value / max) * 100 : 0)];
}
