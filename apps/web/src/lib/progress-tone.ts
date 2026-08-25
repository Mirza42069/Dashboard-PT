/**
 * Which colour a progress bar is drawn in, at a given point along its track.
 *
 * The five-stop scale is defined by --progress-1 through --progress-5 in
 * packages/ui/src/styles/globals.css. A bar samples it along its own length
 * rather than picking one colour for the whole fill.
 *
 * This replaced five discrete bands. Bands had one real argument going for them
 * — they refused to make two projects four points apart look different — but
 * they ran amber → cyan → teal → green, which is a sequence of hues rather than
 * a scale, and nobody could say which of two teals meant "further along".
 *
 * Being *behind schedule* is still not on this ramp, and now it is not on the
 * bar at all. It used to override the fill to --destructive, which stopped
 * working the moment red also meant "barely started". It is a different
 * question anyway — where you are against where you promised to be, not how far
 * along you are — and the DeviationBadge beside every one of these bars states
 * it in words and a number, which is more than a colour could.
 */

const STOPS = [
  "--progress-1",
  "--progress-2",
  "--progress-3",
  "--progress-4",
  "--progress-5",
] as const;

/**
 * The colour at `position` (0–1) along the track.
 *
 * Returns a CSS colour for an inline style, not a class — twenty pills each
 * taking their own step of the ramp is twenty colours, and Tailwind only ships
 * class names it can see written out.
 *
 * The mix is done in CSS rather than in JS so the ramp stays theme-aware: the
 * tokens re-resolve against whichever theme is in scope. Interpolating oklch
 * literals here would bake one theme into the markup.
 */
export function progressRampColor(position: number): string {
  const p = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));

  // Two decimals, because these percentages are divisions and land on things
  // like 74.99999999999999 — which is a valid mix and an unreadable style
  // attribute. Nothing about a colour needs finer than a hundredth of a step.
  const mix = (t: number) => `${Math.round(t * 10000) / 100}%`;

  const scaled = p * (STOPS.length - 1);
  const index = Math.min(Math.floor(scaled), STOPS.length - 2);
  const localPosition = scaled - index;

  // The percentage is of the second colour, so 0% is the first stop unmixed.
  return `color-mix(in oklch, var(${STOPS[index]}), var(${STOPS[index + 1]}) ${mix(localPosition)})`;
}
