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
    <nav
      className={cn(
        "flex flex-col transition-[gap] duration-200 ease-out",
        collapsed ? "gap-1" : "gap-5",
      )}
    >
      {SECTIONS.filter((section) => !section.adminOnly || isAdmin).map((section) => (
        <div key={section.headingKey} className="space-y-1">
          {/* Collapsed: a hairline separates groups, since headings won't fit.
              The heading collapses to zero height rather than unmounting, so it
              slides away with the rail instead of vanishing on the first frame. */}
          {collapsed && <div className="mx-2 my-1 border-t first:hidden" />}
          <p
            aria-hidden={collapsed}
            className={cn(
              "overflow-hidden px-2 text-[0.625rem] font-medium tracking-widest whitespace-nowrap text-muted-foreground uppercase transition-[height,opacity] duration-200 ease-out",
              collapsed ? "h-0 opacity-0" : "h-4 opacity-100",
            )}
          >
            {t.nav[section.headingKey]}
          </p>

          {section.items.map(({ href, labelKey, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            const label = t.nav[labelKey];

            const link = (
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                // The label below stays in the DOM when collapsed, but at zero
                // width — not every screen reader announces a clipped text node
                // reliably, so name the link explicitly rather than depend on it.
                aria-label={collapsed ? label : undefined}
                className={cn(
                  // h-10 in both states. Previously the row was ~30px expanded
                  // and 40px collapsed, so toggling resized every row mid-slide.
                  // w-10 collapsed is not arbitrary either: it puts the icon at
                  // the same 20px from the sidebar edge as the expanded layout
                  // (8px container padding + (40-16)/2), so the icons hold still
                  // while everything around them moves.
                  "flex h-10 items-center rounded-md text-sm transition-[width,gap,padding,background-color,color] duration-200 ease-out",
                  collapsed ? "w-10 justify-center gap-0 px-0" : "w-full gap-2 px-2",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {/* Kept mounted and faded rather than unmounted — a label that
                    disappears instantly is what made the collapse read as a jump
                    rather than a slide. max-w-0 keeps it out of the layout. */}
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out",
                    collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100",
                  )}
                >
                  {label}
                </span>
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
