"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { useState } from "react";

import { writeSidebarCookie } from "@/lib/sidebar";
import type { TextScale } from "@/lib/text-scale";

import AppSidebar from "./app-sidebar";
import ContactSupportDialog from "./contact-support-dialog";
import Header from "./header";
import SkipLink from "./skip-link";
import SupportNoticeDialog from "./support-notice-dialog";

export type ShellUser = {
  name: string;
  email: string;
  role: string;
  /** Null on a normal account. Drives the trial badge in the top bar. */
  trialEndsAt: Date | string | null;
};

/**
 * Owns the sidebar collapse state so the trigger can live in the topbar while
 * the sidebar itself reacts. Initial value comes from a cookie read on the
 * server, so there is no expand-then-collapse flash.
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
  const [supportOpen, setSupportOpen] = useState(false);
  const role = roleOf(user);

  function toggle() {
    setCollapsed((value) => {
      writeSidebarCookie(!value);
      return !value;
    });
  }

  return (
    // overflow-x-hidden matches the reference's .layout and matters more here
    // than it looks: nav labels keep their full natural width while collapsed
    // and are only clipped by the rail, so without this a horizontal scrollbar
    // can flicker in and out across the one-second slide.
    <div className="flex h-svh overflow-x-hidden">
      {/* First in the DOM so it is the first thing Tab reaches. */}
      <SkipLink />
      <AppSidebar
        role={role}
        collapsed={collapsed}
        onContactSupport={() => setSupportOpen(true)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          user={user}
          collapsed={collapsed}
          initialTextScale={initialTextScale}
          onToggleSidebar={toggle}
          onContactSupport={() => setSupportOpen(true)}
        />
        {/* tabIndex={-1} so the skip link can actually land focus here; without
            it the browser scrolls to #main but focus stays on the link, and the
            next Tab goes back into the sidebar. */}
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>
      {role !== "super_admin" && (
        <ContactSupportDialog open={supportOpen} onOpenChange={setSupportOpen} />
      )}
      {role !== "super_admin" && <SupportNoticeDialog enabled={!supportOpen} />}
    </div>
  );
}
