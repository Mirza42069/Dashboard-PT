/**
 * The Fushin mark.
 *
 * Two glyphs — a bowl and a notched banner — lifted verbatim from the source
 * artwork so the curves stay exactly as drawn. Both live in the 810×810 space
 * of the original export; `MARK_VIEWBOX` crops to their tight bounds.
 *
 * The brand lockup: black glyphs on the #5e17eb square. It is the only place
 * purple appears on this site; everything else is navy.
 *
 * The two path strings are exported because the icon and OG-image routes draw
 * the same mark and must not drift from it.
 */

export const BOWL =
  "M146.847656 520.800781C156.96875 524.242188 168.476562 526.5 179.773438 526.5C191.066406 526.5 201.933594 524.5625 211.949219 521.121094C212.164062 521.015625 212.375 521.015625 212.589844 520.90625C250.203125 507.136719 277.90625 470.777344 278.4375 428.289062L278.4375 283.5L81 283.5L81 428.179688C81.53125 470.992188 108.808594 507.351562 146.847656 520.800781Z";

export const BANNER =
  "M729 283.5L729 526.5L618.890625 488.53125L508.78125 526.5L508.78125 283.5Z";

/** Tight bounds of the two glyphs within the original 810x810 artboard. */
export const MARK_VIEWBOX = "81 283.5 648 243";

const BRAND_PURPLE = "#5e17eb";

export function Logo({ size = 28, ...props }: { size?: number } & React.ComponentProps<"svg">) {
  return (
    <svg viewBox="0 0 810 810" width={size} height={size} aria-hidden {...props}>
      <rect width="810" height="810" rx="176" fill={BRAND_PURPLE} />
      <path d={BOWL} fill="#000000" />
      <path d={BANNER} fill="#000000" />
    </svg>
  );
}
