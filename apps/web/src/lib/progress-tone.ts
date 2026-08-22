/**
 * Which colour a progress bar is drawn in, at a given point along its track.
 *
 * The scale is red → amber → green, defined by --progress-low/mid/high in
 * packages/ui/src/styles/globals.css. A bar samples this along its own length
 * rather than picking one colour for the whole fill, so the tip of the fill
 * states how far along it is: barely started ends red, a third of the way ends
 * amber, finished ends green.
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

/**
 * Where amber sits on the ramp: red→amber below it, amber→green above.
 *
 * 0.4 rather than the midpoint, and this is the one number here worth tuning.
 * At 0.5 a bar around 30% still ends in the oranges; pulling the stop back
 * lands it on yellow, which is where a third-finished bar should read.
 */
const MID_STOP = 0.4;

/**
 * The colour at `position` (0–1) along the track.
 *
 * Returns a CSS colour for an inline style, not a class — twenty pills each
 * taking their own step of the ramp is twenty colours, and Tailwind only ships
 * class names it can see written out.
 *
 * The mix is done in CSS rather than in JS so the ramp stays theme-aware: the
 * three stops are different under .dark, and color-mix() re-resolves against
 * whichever is in scope. Interpolating oklch literals here would bake the light
 * theme into the markup.
 */
export function progressRampColor(position: number): string {
  const p = Math.min(1, Math.max(0, Number.isFinite(position) ? position : 0));

  // Two decimals, because these percentages are divisions and land on things
  // like 74.99999999999999 — which is a valid mix and an unreadable style
  // attribute. Nothing about a colour needs finer than a hundredth of a step.
  const mix = (t: number) => `${Math.round(t * 10000) / 100}%`;

  // The percentage is of the *second* colour, so 0% is the first stop unmixed.
  return p <= MID_STOP
    ? `color-mix(in oklch, var(--progress-low), var(--progress-mid) ${mix(p / MID_STOP)})`
    : `color-mix(in oklch, var(--progress-mid), var(--progress-high) ${mix(
        (p - MID_STOP) / (1 - MID_STOP),
      )})`;
}
