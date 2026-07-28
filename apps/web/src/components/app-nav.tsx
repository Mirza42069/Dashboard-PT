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

/**
 * Expo-out. Nearly all the distance is covered in the first third, then it
 * settles — the rail reads as arriving somewhere rather than stopping. Written
 * as a literal class string, not composed at runtime, so Tailwind's scanner
 * still sees `duration-[320ms]` and the `ease-[...]` value in the source.
 *
 * No motion-reduce guard here, deliberately — see the reduced-motion block in
 * packages/ui/src/styles/globals.css. On Windows that query follows Settings >
 * Accessibility > Visual effects > Animation effects, which is off on machines
 * with no motion sensitivity involved (this project's own dev box among them),
 * and it takes the whole collapse with it.
 */
const MOTION = "duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)]";

/**
 * Per-row delay for the label cascade, applied on expand only. Six rows at most
 * (overview + three operations + two admin), so the last label starts at 175ms,
 * while the rail is still widening, and settles at 175 + 320 = 495ms — after the
 * rail has stopped. That overhang is the point: the labels read as settling into
 * a rail that has already arrived, rather than racing it to the same frame.
 */
const STAGGER_MS = 35;

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

  const sections = SECTIONS.filter((section) => !section.adminOnly || isAdmin);

  // Running row number across sections, so the cascade runs down the whole rail
  // rather than restarting at each heading.
  const sectionOffsets: number[] = [];
  let rows = 0;
  for (const section of sections) {
    sectionOffsets.push(rows);
    rows += section.items.length;
  }

  return (
    <nav className={cn("flex flex-col transition-[gap]", MOTION, collapsed ? "gap-1" : "gap-5")}>
      {sections.map((section, sectionIndex) => (
        <div key={section.headingKey} className="space-y-1">
          {/* Collapsed: a hairline separates groups, since headings won't fit.
              Keyed off sectionIndex rather than `first:hidden`, which never
              rendered a separator at all — the rule was meant to skip the one
              above the first section, but the hairline is the first child of
              every section wrapper, so :first-child always matched.
              The heading collapses to zero height rather than unmounting, so it
              slides away with the rail instead of vanishing on the first frame. */}
          {collapsed && sectionIndex > 0 && <div className="mx-2 my-1 border-t" />}
          <p
            aria-hidden={collapsed}
            className={cn(
              "overflow-hidden px-2 text-[0.625rem] font-medium tracking-widest whitespace-nowrap text-muted-foreground uppercase transition-[height,opacity,transform]",
              MOTION,
              // Drifting left as it collapses ties the heading to the rail's
              // direction of travel instead of just dimming in place.
              collapsed ? "h-0 -translate-x-1 opacity-0" : "h-4 translate-x-0 opacity-100",
            )}
          >
            {t.nav[section.headingKey]}
          </p>

          {section.items.map(({ href, labelKey, icon: Icon }, itemIndex) => {
            const isActive = pathname === href || pathname.startsWith(`${href}/`);
            const label = t.nav[labelKey];
            const order = sectionOffsets[sectionIndex] + itemIndex;

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
                  "relative flex h-10 items-center rounded-md text-sm transition-[width,gap,padding,background-color,color]",
                  MOTION,
                  collapsed ? "w-10 justify-center gap-0 px-0" : "w-full gap-2 px-2",
                  isActive
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {/* Active marker grows from the row's centre line rather than
                    fading, so moving between pages reads as the bar travelling. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 w-0.5 rounded-r-full bg-foreground transition-[height,opacity]",
                    MOTION,
                    isActive ? "h-5 opacity-100" : "h-0 opacity-0",
                  )}
                />
                {/* Collapsed, the icon is the only thing left carrying the row,
                    so it takes over a little of the label's visual weight. */}
                <Icon
                  className={cn(
                    "size-4 shrink-0 transition-transform",
                    MOTION,
                    collapsed ? "scale-110" : "scale-100",
                  )}
                />
                {/* Kept mounted and faded rather than unmounted — a label that
                    disappears instantly is what made the collapse read as a jump
                    rather than a slide. max-w-0 keeps it out of the layout. */}
                <span
                  style={{
                    // Cascade on the way out only. Expanding is the gesture worth
                    // decorating; on collapse the labels need to be gone before
                    // the rail reaches them, or they clip against the edge.
                    transitionDelay: collapsed ? "0ms" : `${order * STAGGER_MS}ms`,
                  }}
                  className={cn(
                    "overflow-hidden whitespace-nowrap transition-[max-width,opacity,transform]",
                    MOTION,
                    collapsed ? "max-w-0 -translate-x-2 opacity-0" : "max-w-40 translate-x-0 opacity-100",
                  )}
                >
                  {label}
                </span>
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
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
