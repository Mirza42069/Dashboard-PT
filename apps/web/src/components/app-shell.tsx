"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { useState } from "react";

import { writeSidebarCookie } from "@/lib/sidebar";
import type { TextScale } from "@/lib/text-scale";

import AppSidebar from "./app-sidebar";
import Header from "./header";
import SkipLink from "./skip-link";

export type ShellUser = {
  name: string;
  email: string;
  role: string;
  /** Null on a normal account. Drives the trial badge in the top bar. */
  trialEndsAt: Date | string | null;
};

/**
 * Owns the sidebar collapse state. The trigger lives in the rail's own top
 * block, but the state belongs here because this is what persists it to the
 * cookie. Initial value comes from that cookie read on the server, so there is
 * no expand-then-collapse flash.
 */
export default function AppShell({
  user,
  initialCollapsed,
  initialTextScale,
  children,
}: {
  user: ShellUser;
  initialCollapsed: boolean;
  initialTextScale: TextScale;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const role = roleOf(user);

  function toggle() {
    setCollapsed((value) => {
      writeSidebarCookie(!value);
      return !value;
    });
  }

  return (
    // overflow-hidden matches the reference's .layout and matters more here
    // than it looks: nav labels keep their full natural width while collapsed
    // and are only clipped by the rail, so without this a horizontal scrollbar
    // can flicker in and out across the one-second slide.
    //
    // Both axes, not just x. `overflow-x: hidden` with `overflow-y: visible` is
    // not a thing CSS will give you — the spec computes the visible axis to
    // `auto` — so this element was silently a vertical scroll container. It is
    // exactly h-svh and everything inside scrolls itself, so the only scrollbar
    // it could ever show is one for content that has escaped its box: the third
    // bar down the right-hand edge, next to <main>'s and the grid's.
    <div data-app-shell className="flex h-svh overflow-hidden">
      {/* First in the DOM so it is the first thing Tab reaches. */}
      <SkipLink />
      <AppSidebar role={role} collapsed={collapsed} onToggle={toggle} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header user={user} initialTextScale={initialTextScale} />
        {/* tabIndex={-1} so the skip link can actually land focus here; without
            it the browser scrolls to #main but focus stays on the link, and the
            next Tab goes back into the sidebar. */}
        {/* min-h-0 is what makes overflow-y-auto work at all. A flex item
            defaults to `min-height: auto`, which floors it at its content
            height — so a long page grew this column past h-svh instead of
            scrolling inside it, and the page ran on past the last card into
            dead space. */}
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
