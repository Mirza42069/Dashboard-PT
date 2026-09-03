"use client";

import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import { trialDaysRemaining } from "@DashboardV2/api/lib/trial";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Clock } from "@DashboardV2/ui/components/icons";

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
  initialTextScale,
}: {
  user: ShellUser;
  initialTextScale: TextScale;
}) {
  const t = useT();
  const role = roleOf(user);
  const trialDays = trialDaysRemaining(user);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 md:px-4">
      {/* The desktop collapse control lives in the rail itself (app-sidebar.tsx),
          so all that is left on this edge is the mobile Sheet trigger. */}
      <MobileNav role={role} />
      {/* Global controls stay together at the trailing edge of the top bar. */}
      <div className="ms-auto flex items-center gap-2">
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
