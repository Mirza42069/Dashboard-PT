"use client";

import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import { trialDaysRemaining } from "@DashboardV2/api/lib/trial";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import { ChevronLeft, Clock } from "@DashboardV2/ui/components/icons";

import { plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import type { TextScale } from "@/lib/text-scale";

import type { ShellUser } from "./app-shell";
import ActivityPopover from "./activity-popover";
import CompanySwitcher from "./company-switcher";
import MobileNav from "./mobile-nav";
import UserMenu from "./user-menu";

export default function Header({
  user,
  collapsed,
  initialTextScale,
  onToggleSidebar,
}: {
  user: ShellUser;
  collapsed: boolean;
  initialTextScale: TextScale;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const role = roleOf(user);
  const trialDays = trialDaysRemaining(user);
  const label = collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 md:px-4">
      <div className="flex items-center gap-1">
        <MobileNav role={role} />
        {/* Desktop only — on mobile the Sheet is the navigation. */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                aria-label={label}
                onClick={onToggleSidebar}
              />
            }
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
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
      </div>
      {/* Global controls stay together at the trailing edge of the top bar. */}
      <div className="flex items-center gap-2">
        {/* A trial is a deadline the account cannot see anywhere else, and
            missing it locks them out — so it is stated in the chrome rather
            than left to the admin screen they have no access to. */}
        {trialDays !== null && (
          <Badge variant="secondary" className="hidden sm:inline-flex">
            <Clock />
            {trialDays === 0 ? t.trial.endsToday : plural(t.trial.daysLeft, trialDays)}
          </Badge>
        )}
        {hasPermission(role, "activity:read") && <ActivityPopover />}
        {hasPermission(role, "company:switch") && <CompanySwitcher />}
        <UserMenu user={user} initialTextScale={initialTextScale} />
      </div>
    </header>
  );
}
