import { cn } from "@DashboardV2/ui/lib/utils";

export const BRAND_NAME = "Fushin";

/**
 * The Fushin mark. Defined once here so every visible app surface stays in sync.
 * Mirrors apps/web/src/app/icon.svg.
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
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap font-semibold leading-none tracking-[0.08em] text-primary",
        size === "lg" ? "size-10 text-lg" : "size-6 text-[0.6875rem]",
        className,
      )}
    >
      <span
        lang="ja"
        aria-hidden="true"
        style={{ fontFamily: '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif' }}
      >
        普請
      </span>
    </span>
  );
}
