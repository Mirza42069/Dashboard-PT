import type { Role } from "@DashboardV2/api/lib/permissions";
import type { CompanyScope } from "@DashboardV2/api/lib/scope";
import { cn } from "@DashboardV2/ui/lib/utils";

import AppNav from "./app-nav";
import { BrandMark } from "./brand";

export default function AppSidebar({
  role,
  collapsed,
  vertical,
}: {
  role: Role;
  collapsed: boolean;
  vertical: CompanyScope["vertical"];
}) {
  return (
    <aside
      className={cn(
        // Same curve and duration as everything inside the rail — see MOTION in
        // app-nav.tsx. Mismatched easing between the container and its contents
        // is what makes a collapse look like two animations fighting.
        //
        // This one transition is the entire gesture. The rail is an in-flow flex
        // sibling of the content column, so animating its width drives the page
        // as well; kolejain animates a grid track *and* the rail width only
        // because its own rail is position:fixed and needs the track to hold
        // space for it.
        "hidden shrink-0 flex-col border-r bg-card transition-[width] duration-[1000ms] ease-[cubic-bezier(0.075,0.82,0.165,1)] md:flex",
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
       * over a full second while the class swap is instant — the mark would jump
       * to the middle of the still-224px sidebar and slide back. Anchoring to a
       * fixed padding makes its position independent of the animating width.
       */}
      <div className="flex h-12 shrink-0 items-center overflow-hidden border-b px-4">
        {/* Completely still, and no longer scaling on collapse. The rail's edge
            is the only thing that moves in this animation; the mark holding its
            exact position is what sells the edge as travelling over it rather
            than the contents rearranging themselves. */}
        <BrandMark />
      </div>
      {/* px-3 unconditionally. This is not just a simplification of the old
          px-2/px-3 swap — it is what lets the icons hold still. 12px here plus
          the row's own px-2 puts every icon's left edge at 20px, which is
          exactly where the previous collapsed layout landed it via w-10 and
          justify-center (8 + (40-16)/2). Identical in both states, so there is
          nothing left for a padding transition to do. */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <AppNav role={role} collapsed={collapsed} vertical={vertical} />
      </div>
    </aside>
  );
}
