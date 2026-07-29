import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@DashboardV2/ui/lib/utils";
import * as React from "react";

/*
 * `text-base md:text-xs`, not `text-xs` throughout. iOS Safari zooms the whole
 * page when a focused input's text is under 16px, and there is no way to opt out
 * that does not also block pinch zoom. So the field is 16px on phones — where
 * the extra height costs nothing — and drops to the product's 12px density from
 * `md` up, where no mobile Safari is running.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 md:h-8 md:text-xs dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
