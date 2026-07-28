"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import { Boxes, Building2, HardHat, LayoutDashboard, Truck, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Dictionary } from "@/i18n";
import { useT } from "@/i18n/provider";

type NavItem = {
  href: Route;
  labelKey: keyof Dictionary["nav"];
  icon: typeof LayoutDashboard;
};

type NavSection = {
  headingKey: keyof Dictionary["nav"];
  adminOnly: boolean;
  items: NavItem[];
};

/**
 * `adminOnly` hides a section from the sidebar; it is not the access control.
 * The pages themselves call requireAdmin() and the procedures use
 * adminProcedure — hiding here is only so people don't see dead links.
 *
 * Settings deliberately lives in the account menu, not here: it configures the
 * person, not the business.
 */
const SECTIONS: NavSection[] = [
  {
    headingKey: "overview",
    adminOnly: false,
    items: [{ href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard }],
  },
  {
    headingKey: "operations",
    adminOnly: false,
    items: [
      { href: "/projects", labelKey: "projects", icon: HardHat },
      { href: "/materials", labelKey: "materials", icon: Boxes },
      { href: "/equipment", labelKey: "equipment", icon: Truck },
    ],
  },
  {
    headingKey: "administration",
    adminOnly: true,
    items: [
      { href: "/admin/users", labelKey: "users", icon: Users },
      { href: "/admin/companies", labelKey: "companies", icon: Building2 },
    ],
  },
];

export default function AppNav({
  isAdmin,
  collapsed = false,
  onNavigate,
}: {
  isAdmin: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col", collapsed ? "gap-1" : "gap-5")}>
      {SECTIONS.filter((section) => !section.adminOnly || isAdmin).map((section) => (
        <div key={section.headingKey} className="space-y-1">
          {/* Collapsed: a hairline separates groups, since headings won't fit. */}
          {collapsed ? (
            <div className="mx-2 my-1 border-t first:hidden" />
          ) : (
            <p className="px-2 text-[0.625rem] font-medium tracking-widest text-muted-foreground uppercase">
              {t.nav[section.headingKey]}
            </p>
          )}

          {section.items.map(({ href, labelKey, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            const label = t.nav[labelKey];

            const link = (
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  "flex items-center rounded-md text-xs transition-colors",
                  collapsed ? "size-10 justify-center" : "gap-2 px-2 py-1.5",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && label}
              </Link>
            );

            return collapsed ? (
              <Tooltip key={href}>
                <TooltipTrigger render={link} />
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              <div key={href}>{link}</div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
