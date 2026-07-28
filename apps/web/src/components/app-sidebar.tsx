import { cn } from "@DashboardV2/ui/lib/utils";

import AppNav from "./app-nav";
import { BrandMark } from "./brand";

export default function AppSidebar({
  isAdmin,
  collapsed,
}: {
  isAdmin: boolean;
  collapsed: boolean;
}) {
  return (
    <aside
      className={cn(
        // Same curve and duration as everything inside the rail — see MOTION in
        // app-nav.tsx. Mismatched easing between the container and its contents
        // is what makes a collapse look like two animations fighting.
        "hidden shrink-0 flex-col border-r bg-card transition-[width] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      {/*
       * The mark already reads "V2" — a wordmark beside it would just say it twice.
       *
       * px-4 unconditionally, and deliberately so. The rail is w-14 (56px) and
       * the mark is size-6 (24px), so 16px of padding leaves it in exactly the
       * place centring would: (56 - 24) / 2 = 16. Switching to justify-center
       * when collapsed looks equivalent but is not, because `width` animates
       * over 320ms while the class swap is instant — the mark would jump to the
       * middle of the still-224px sidebar and slide back. Anchoring to a fixed
       * padding makes its position independent of the animating width.
       */}
      <div className="flex h-12 shrink-0 items-center border-b px-4">
        {/* The mark holds its position through the slide (see above), so a small
            scale is the one bit of motion it can carry. origin-left is what
            keeps that true: scale() is centre-origin by default, and the mark is
            24px, so scale-110 would pull its left edge to 14.8px — off the 16px
            anchor, and in the opposite direction from the rail's travel. */}
        <div
          className={cn(
            "origin-left transition-transform duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            collapsed ? "scale-110" : "scale-100",
          )}
        >
          <BrandMark />
        </div>
      </div>
      {/* Padding transitions on the same curve as the rail; snapping it would
          shift every nav row sideways on the first frame of the slide. */}
      <div
        className={cn(
          "flex-1 overflow-y-auto py-3 transition-[padding] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
          collapsed ? "px-2" : "px-3",
        )}
      >
        <AppNav isAdmin={isAdmin} collapsed={collapsed} />
      </div>
    </aside>
  );
}
