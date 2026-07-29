"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";

import type { ShellUser } from "./app-shell";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/**
 * Takes the user as a prop rather than calling authClient.useSession(). That
 * hook only resolves in the browser, so SSR rendered a loading skeleton while
 * the client rendered the real menu — React treated the whole tree as
 * mismatched and re-rendered it, refetching every dashboard query on load.
 *
 * The (app) layout has already resolved and verified the session server-side,
 * so there is nothing to look up again here.
 */
export default function UserMenu({ user }: { user: ShellUser }) {
  const t = useT();
  const router = useRouter();
  const role = roleOf(user);
  const isSuperAdmin = role === "super_admin";
  const isRowAdmin = role === "admin";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-medium">
          {initials(user.name)}
        </span>
        <span className="hidden sm:inline">{user.name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 bg-card">
        <div className="space-y-1 px-2 py-2">
          <p className="text-xs font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <Badge variant={isSuperAdmin ? "default" : isRowAdmin ? "secondary" : "outline"}>
            {isSuperAdmin ? t.users.roleSuperAdmin : isRowAdmin ? t.users.roleAdmin : t.users.roleUser}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/settings" />}>
            <Settings />
            {t.nav.settings}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    router.push("/login");
                    router.refresh();
                  },
                },
              });
            }}
          >
            <LogOut />
            {t.auth.signOut}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
