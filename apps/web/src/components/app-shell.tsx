"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { useState } from "react";

import { writeSidebarCookie } from "@/lib/sidebar";

import AppSidebar from "./app-sidebar";
import Header from "./header";
import SkipLink from "./skip-link";

export type ShellUser = { name: string; email: string; role: string };

/**
 * Owns the sidebar collapse state so the trigger can live in the topbar while
 * the sidebar itself reacts. Initial value comes from a cookie read on the
 * server, so there is no expand-then-collapse flash.
 */
export default function AppShell({
  user,
  initialCollapsed,
  children,
}: {
  user: ShellUser;
  initialCollapsed: boolean;
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
    <div className="flex h-svh">
      {/* First in the DOM so it is the first thing Tab reaches. */}
      <SkipLink />
      <AppSidebar role={role} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} collapsed={collapsed} onToggleSidebar={toggle} />
        {/* tabIndex={-1} so the skip link can actually land focus here; without
            it the browser scrolls to #main but focus stays on the link, and the
            next Tab goes back into the sidebar. */}
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
