"use client";

import type { Role } from "@DashboardV2/api/lib/permissions";
import { Button } from "@DashboardV2/ui/components/button";
import { Headset, LifeBuoy } from "@DashboardV2/ui/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useT } from "@/i18n/provider";

export default function SupportNavItem({
  role,
  collapsed = false,
  onContactSupport,
  onNavigate,
}: {
  role: Role;
  collapsed?: boolean;
  onContactSupport: () => void;
  onNavigate?: () => void;
}) {
  const t = useT();
  const pathname = usePathname();
  const isSystem = role === "super_admin";
  const isActive = isSystem && pathname.startsWith("/admin/support");
  const supportHref = "/admin/support" as Route;
  const label = isSystem ? t.support.inboxTitle : t.support.contactSupport;
  const className = cn(
    "relative flex h-10 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-sm transition-[background-color,color] duration-[400ms]",
    isActive
      ? "bg-muted font-medium text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute left-0 w-0.5 rounded-r-full bg-foreground transition-[height,opacity] duration-[400ms]",
          isActive ? "h-5 opacity-100" : "h-0 opacity-0",
        )}
      />
      {/* One nav slot serves two different features depending on role — the
          global inbox for System accounts, the contact form for everyone else.
          Same icon made them look like the same thing. */}
      {isSystem ? (
        <Headset className="size-4 shrink-0" />
      ) : (
        <LifeBuoy className="size-4 shrink-0" />
      )}
      <span className="shrink-0 whitespace-nowrap">{label}</span>
    </>
  );

  const control = isSystem ? (
    <Link
      href={supportHref}
      onClick={onNavigate}
      aria-current={isActive ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={className}
    >
      {content}
    </Link>
  ) : (
    <Button
      type="button"
      variant="ghost"
      onClick={onContactSupport}
      aria-label={collapsed ? label : undefined}
      className={cn(className, "justify-start font-normal")}
    >
      {content}
    </Button>
  );

  return (
    <Tooltip disabled={!collapsed}>
      <TooltipTrigger render={control} />
      <TooltipContent side="inline-end">{label}</TooltipContent>
    </Tooltip>
  );
}
