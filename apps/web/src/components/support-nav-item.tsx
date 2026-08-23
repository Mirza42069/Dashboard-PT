"use client";

import type { Role } from "@DashboardV2/api/lib/permissions";
import { Headset, LifeBuoy } from "@DashboardV2/ui/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

/** Matches the support inbox; nothing here needs to be fresher than that. */
const POLL_INTERVAL_MS = 30_000;

export default function SupportNavItem({
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
  const isSystem = role === "super_admin";

  // Two different features share this slot: the global inbox for System
  // accounts, the requester's own conversations for everyone else.
  const supportHref = (isSystem ? "/admin/support" : "/support") as Route;
  const isActive = pathname === supportHref || pathname.startsWith(`${supportHref}/`);
  // Not "Contact support" any more: for a requester this leads to their
  // conversations, of which starting a new one is only part.
  const label = isSystem ? t.support.inboxTitle : t.nav.support;

  // System accounts cannot file a request, so they are never the requester the
  // badge counts for — the query would always answer zero.
  const unreadQuery = useQuery({
    ...trpc.support.unreadCount.queryOptions(),
    enabled: !isSystem,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const unread = isSystem ? 0 : (unreadQuery.data?.unread ?? 0);

  const className = cn(
    "relative flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm transition-[background-color,color] duration-[400ms]",
    isActive
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  const control = (
    <Link
      href={supportHref}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      // Collapsed, the label is clipped rather than unmounted, and the count
      // would be clipped with it — so the accessible name carries both.
      aria-label={
        collapsed || unread > 0
          ? unread > 0
            ? `${label} — ${interpolate(t.support.unreadCount, { count: String(unread) })}`
            : label
          : undefined
      }
      className={className}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 w-0.5 rounded-r-full bg-foreground transition-[height,opacity] duration-[400ms]",
          isActive ? "h-5 opacity-100" : "h-0 opacity-0",
        )}
      />
      {isSystem ? (
        <Headset className="size-4 shrink-0" />
      ) : (
        <LifeBuoy className="size-4 shrink-0" />
      )}
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      {unread > 0 && (
        <>
          {/* Expanded: a counted pill after the label. Not shrink-0 against the
              rail's clipping edge — it should slide out of view with the text
              rather than pin itself to the icon. */}
          <span
            aria-hidden
            className="ml-auto shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium text-primary-foreground tabular-nums"
          >
            {unread}
          </span>
          {/* Collapsed: the pill is clipped away with everything else, so a dot
              rides the icon instead. Purely decorative — the count is in the
              link's accessible name above. */}
          {collapsed && (
            <span
              aria-hidden
              className="absolute top-2 left-6 size-2 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </>
      )}
    </Link>
  );

  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger render={control} />
      <TooltipContent side="inline-end">
        {unread > 0
          ? `${label} — ${interpolate(t.support.unreadCount, { count: String(unread) })}`
          : label}
      </TooltipContent>
    </Tooltip>
  );
}
