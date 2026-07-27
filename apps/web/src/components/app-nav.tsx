"use client";

import { cn } from "@DashboardV2/ui/lib/utils";
import { LayoutDashboard, Users } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
};

type NavSection = {
  heading: string;
  adminOnly: boolean;
  items: NavItem[];
};

/**
 * `adminOnly` hides a section from the sidebar; it is not the access control.
 * The pages themselves call requireAdmin() and the procedures use
 * adminProcedure — hiding here is only so people don't see dead links.
 */
const SECTIONS: NavSection[] = [
  {
    heading: "Overview",
    adminOnly: false,
    items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    heading: "Administration",
    adminOnly: true,
    items: [{ href: "/admin/users", label: "Users", icon: Users }],
  },
];

export default function AppNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-5">
      {SECTIONS.filter((section) => !section.adminOnly || isAdmin).map((section) => (
        <div key={section.heading} className="space-y-1">
          <p className="px-2 text-[0.625rem] font-medium tracking-widest text-muted-foreground uppercase">
            {section.heading}
          </p>
          {section.items.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 text-xs transition-colors",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
