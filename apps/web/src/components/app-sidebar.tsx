"use client";

import type { Role } from "@DashboardV2/api/lib/permissions";
import { Button } from "@DashboardV2/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import { ChevronLeft } from "@DashboardV2/ui/components/icons";

import { useT } from "@/i18n/provider";

import AppNav from "./app-nav";
import SupportNavItem from "./support-nav-item";

export default function AppSidebar({
  role,
  collapsed,
  onToggle,
}: {
  role: Role;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const label = collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar;

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
       * The rail's own control lives where the brand mark used to. h-12 and the
       * bottom border are load-bearing regardless of what sits in here: they are
       * what keeps this block's rule continuous with the top bar's.
       *
       * px-3 unconditionally, and deliberately so. 12px of padding plus a size-8
       * button centring a size-4 glyph puts the icon's left edge at
       * 12 + (32 - 16) / 2 = 20px — exactly the column every nav icon below sits
       * in (px-3 here plus each row's own px-2; see app-nav.tsx). Switching to
       * justify-center when collapsed looks equivalent but is not, because
       * `width` animates over a full second while a class swap is instant — the
       * button would jump to the middle of the still-224px rail and slide back.
       * Anchoring to a fixed padding makes its position independent of the
       * animating width.
       */}
      <div className="flex h-12 shrink-0 items-center overflow-hidden border-b px-3">
        <Tooltip>
          <TooltipTrigger
            render={<Button variant="ghost" size="icon" aria-label={label} onClick={onToggle} />}
          >
            {/* One icon that rotates, not two that swap. Swapping is instant and
                leaves the button out of the gesture entirely; rotating makes it
                part of the same movement as the rail.
                600ms and the browser's default `ease`, both matching the
                reference's .arrow rule — which pointedly does not use its own
                --transition curve. Spelled out because Tailwind's default
                transition timing is a different curve. Finishing before the
                1000ms rail does is intended: the control settles, then the rail
                catches up to it. */}
            <ChevronLeft
              className={cn(
                "transition-transform duration-[600ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]",
                collapsed && "rotate-180",
              )}
            />
          </TooltipTrigger>
          <TooltipContent side="inline-end">{label}</TooltipContent>
        </Tooltip>
      </div>
      {/* px-3 unconditionally. This is not just a simplification of the old
          px-2/px-3 swap — it is what lets the icons hold still. 12px here plus
          the row's own px-2 puts every icon's left edge at 20px, which is
          exactly where the previous collapsed layout landed it via w-10 and
          justify-center (8 + (40-16)/2). Identical in both states, so there is
          nothing left for a padding transition to do. */}
      {/* min-h-0: same reason as <main> in app-shell.tsx — without it this
          item cannot shrink below its content and the rail grows past h-svh. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <AppNav role={role} collapsed={collapsed} />
      </div>
      <div className="shrink-0 border-t px-3 py-3">
        <SupportNavItem role={role} collapsed={collapsed} />
      </div>
    </aside>
  );
}
