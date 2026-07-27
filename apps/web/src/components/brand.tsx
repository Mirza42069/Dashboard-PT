import { cn } from "@DashboardV2/ui/lib/utils";

/**
 * The V2 mark. Defined once here so the sidebar, the login card and any future
 * surface can't drift apart. Mirrors apps/web/src/app/icon.svg.
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
      aria-hidden
      className={cn(
        "flex items-center justify-center bg-primary font-semibold text-primary-foreground",
        size === "lg" ? "size-10 rounded-lg text-sm" : "size-6 rounded-md text-[0.625rem]",
        className,
      )}
    >
      V2
    </span>
  );
}

export const BRAND_NAME = "V2";
