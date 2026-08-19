import { cn } from "@DashboardV2/ui/lib/utils";

export const BRAND_NAME = "Fushin";

const BOWL =
  "M146.847656 520.800781C156.96875 524.242188 168.476562 526.5 179.773438 526.5C191.066406 526.5 201.933594 524.5625 211.949219 521.121094C212.164062 521.015625 212.375 521.015625 212.589844 520.90625C250.203125 507.136719 277.90625 470.777344 278.4375 428.289062L278.4375 283.5L81 283.5L81 428.179688C81.53125 470.992188 108.808594 507.351562 146.847656 520.800781Z";

const BANNER =
  "M729 283.5L729 526.5L618.890625 488.53125L508.78125 526.5L508.78125 283.5Z";

/**
 * The Fushin mark. Defined once here so every visible app surface stays in sync.
 * Mirrors apps/web/src/app/icon.svg and apps/marketing/src/components/logo.tsx.
 *
 * The glyphs are drawn in the 810x810 space of the source artwork; the tile is
 * the only surface carrying brand purple, so it survives both themes untouched.
 */
export function BrandMark({
  size = "sm",
  className,
}: {
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={BRAND_NAME}
      className={cn("inline-flex shrink-0", size === "lg" ? "size-10" : "size-6", className)}
    >
      <svg viewBox="0 0 810 810" className="size-full" aria-hidden="true">
        <rect width="810" height="810" rx="176" fill="#5e17eb" />
        <path d={BOWL} fill="#000000" />
        <path d={BANNER} fill="#000000" />
      </svg>
    </span>
  );
}
