/** One decimal place is shown in the UI, so half a tenth is the meaningful edge. */
export const DEVIATION_DISPLAY_THRESHOLD = 0.05;

export type DeviationPosition = "behind" | "on_track" | "ahead";

export function deviationPosition(value: number | null): DeviationPosition | null {
  if (value === null) return null;
  if (value <= -DEVIATION_DISPLAY_THRESHOLD) return "behind";
  if (value >= DEVIATION_DISPLAY_THRESHOLD) return "ahead";
  return "on_track";
}

export function isBehindDeviation(value: number | null): boolean {
  return deviationPosition(value) === "behind";
}
