"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { Button } from "@DashboardV2/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { useT } from "@/i18n/provider";

import type { ShellUser } from "./app-shell";
import CompanySwitcher from "./company-switcher";
import MobileNav from "./mobile-nav";
import UserMenu from "./user-menu";

export default function Header({
  user,
  collapsed,
  onToggleSidebar,
}: {
  user: ShellUser;
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const t = useT();
  const label = collapsed ? t.nav.expandSidebar : t.nav.collapseSidebar;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b bg-card px-3 md:px-4">
      <div className="flex items-center gap-1">
        <MobileNav role={roleOf(user)} />
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
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>
        <CompanySwitcher />
      </div>
      <UserMenu user={user} />
    </header>
  );
}
