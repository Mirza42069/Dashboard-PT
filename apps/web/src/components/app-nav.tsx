"use client";

import { hasPermission, type Permission, type Role } from "@DashboardV2/api/lib/permissions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import { Building2, HardHat, LayoutDashboard, Users } from "@DashboardV2/ui/components/icons";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Dictionary } from "@/i18n";
import { useT } from "@/i18n/provider";

type NavItem = {
  href: Route;
  labelKey: keyof Dictionary["nav"];
  icon: typeof LayoutDashboard;
  /** Omitted entirely means every role sees it. */
  permission?: Permission;
};

type NavSection = {
  headingKey?: keyof Dictionary["nav"];
  items: NavItem[];
};

/**
 * `permission` hides an item from the sidebar; it is not the access control.
 * The pages themselves call requirePermission() and the procedures declare
 * the same permission — hiding here is only so people don't see dead links.
 *
 * Settings deliberately lives in the account menu, not here: it configures the
 * person, not the business.
 */
const SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
      { href: "/projects", labelKey: "projects", icon: HardHat },
    ],
  },
  {
    headingKey: "administration",
    items: [
      { href: "/admin/users", labelKey: "users", icon: Users, permission: "user:manage" },
      { href: "/admin/companies", labelKey: "companies", icon: Building2, permission: "company:manage" },
    ],
  },
];

/**
 * Circ-out over a full second, matching kolejain.com's `--transition` and the
 * 1s on its `.sidebar-cont { transition: width }`. Almost all the distance goes
 * in the first ~350ms and the rest is a long settle, so the rail reads as
 * gliding to a stop rather than easing off. Written as a literal class string,
 * not composed at runtime, so Tailwind's scanner still sees `duration-[1000ms]`
 * and the `ease-[...]` value in the source. No spaces inside cubic-bezier() —
 * Tailwind will not parse an arbitrary value that contains them.
 *
 * This times the rail and the things that must move *with* it. It deliberately
 * does not touch hover colour; see the row below.
 *
 * No motion-reduce guard here, deliberately — see the reduced-motion block in
 * packages/ui/src/styles/globals.css. On Windows that query follows Settings >
 * Accessibility > Visual effects > Animation effects, which is off on machines
 * with no motion sensitivity involved (this project's own dev box among them),
 * and it takes the whole collapse with it.
 */
const MOTION = "duration-[1000ms] ease-[cubic-bezier(0.075,0.82,0.165,1)]";

export default function AppNav({
  role,
  collapsed = false,
  onNavigate,
}: {
  role: Role;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || hasPermission(role, item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <nav className={cn("flex flex-col transition-[gap]", MOTION, collapsed ? "gap-1" : "gap-5")}>
      {sections.map((section, sectionIndex) => (
        <div key={section.headingKey ?? "main"} className="space-y-1">
          {/* Collapsed: a hairline separates groups, since headings won't fit.
              Keyed off sectionIndex rather than `first:hidden`, which never
              rendered a separator at all — the rule was meant to skip the one
              above the first section, but the hairline is the first child of
              every section wrapper, so :first-child always matched.
              The heading collapses to zero height rather than unmounting, so it
              slides away with the rail instead of vanishing on the first frame. */}
          {collapsed && sectionIndex > 0 && <div className="mx-2 my-1 border-t" />}
          {/* The one thing in the rail that fades rather than clips. Headings
              are the exception because a partial word ("OPERA") would sit there
              for most of a one-second slide, which nothing else here risks.
              Mirrors the reference's only fading element, .time-cont, which
              fades on .1s while everything around it moves on the 1s curve.
              Two durations against the two properties, in order: the height
              closes with the rail so the rows below it travel in sync, while
              the text itself is gone in 100ms. Collapsing both onto one
              duration is what makes this look wrong — a fast height snaps every
              row upward while the rail is still a tenth of the way through. */}
          {section.headingKey && (
            <p
              aria-hidden={collapsed}
              className={cn(
                "overflow-hidden px-2 text-[0.6875rem] font-medium tracking-widest whitespace-nowrap text-muted-foreground uppercase",
                "transition-[height,opacity] duration-[1000ms,100ms] ease-[cubic-bezier(0.075,0.82,0.165,1)]",
                collapsed ? "h-0 opacity-0" : "h-4 opacity-100",
              )}
            >
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
                // The label below stays in the DOM when collapsed, just clipped
                // by the row's overflow edge — not every screen reader announces
                // a clipped text node reliably, so name the link explicitly
                // rather than depend on it.
                aria-label={collapsed ? label : undefined}
                className={cn(
                  // Geometrically identical in both states — no width, gap or
                  // padding swap. That is the whole trick behind the reference
                  // animation: nothing inside the rail moves, and the rail's
                  // own edge travels over the content and clips it. The moment
                  // the row changes shape, icons drift and the illusion goes.
                  //
                  // Combined with the container's px-3 (see app-sidebar.tsx),
                  // px-2 here puts the icon 20px from the rail edge, which is
                  // where the old collapsed layout landed it too.
                  "relative flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm",
                  // Colour only, and pointedly not on MOTION. Hover has nothing
                  // to do with the collapse, and at 1000ms a row would take a
                  // full second to light up under the cursor. The reference
                  // keeps its own hover on a separate rule for the same reason:
                  // .label { transition: background-color .4s }.
                  "transition-[background-color,color] duration-[400ms]",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {/* Active marker grows from the row's centre line rather than
                    fading, so moving between pages reads as the bar travelling.
                    On the row's own 400ms and not MOTION: this fires on
                    navigation, not on collapse, and a marker that took a full
                    second to arrive would still be growing well after the new
                    page had rendered. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 w-0.5 rounded-r-full bg-foreground transition-[height,opacity] duration-[400ms]",
                    isActive ? "h-5 opacity-100" : "h-0 opacity-0",
                  )}
                />
                {/* Never scales. It is the fixed point the slide is measured
                    against — if it grows, the rail stops looking like it is
                    passing over the row and starts looking like the row is
                    reacting to it. */}
                <Icon className="size-4 shrink-0" />
                {/* No transition at all, which is the point. The label keeps its
                    natural width the whole time and the row's overflow-hidden
                    edge cuts it off as the rail narrows — the reference does
                    exactly this and never fades or moves its text.
                    shrink-0 is load-bearing: without it flex squeezes the span
                    as the row narrows and the text reflows or wraps instead of
                    being cleanly clipped.
                    Still in the DOM and still in the accessibility tree when
                    clipped, but the aria-label above names the link explicitly
                    rather than relying on that. */}
                <span className="shrink-0 whitespace-nowrap">{label}</span>
              </Link>
            );

            // Wrapped in Tooltip in both states and disabled when expanded,
            // rather than swapping between Tooltip and a plain div. Swapping
            // changes the element type at this position, so React unmounts and
            // remounts the Link on every toggle — and a freshly mounted node has
            // no previous value to transition from. Everything above would land
            // on its target classes on the first frame while the rail slid,
            // which is the jump the rest of this file exists to avoid.
            return (
              <Tooltip key={href} disabled={!collapsed}>
                <TooltipTrigger render={link} />
                <TooltipContent side="inline-end">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
