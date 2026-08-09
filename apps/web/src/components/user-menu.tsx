"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button, buttonVariants } from "@DashboardV2/ui/components/button";
import {
  Accessibility,
  Building2,
  KeyRound,
  Languages,
  LogOut,
} from "@DashboardV2/ui/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@DashboardV2/ui/components/popover";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { Locale } from "@/i18n";
import { setLocaleCookie, useLocale, useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";
import { setTextScaleCookie, type TextScale } from "@/lib/text-scale";
import { trpc } from "@/utils/trpc";

import type { ShellUser } from "./app-shell";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function Preference<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "secondary" : "outline"}
          size="sm"
          aria-pressed={value === option.value}
          onClick={() => {
            if (option.value !== value) onSelect(option.value);
          }}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export default function UserMenu({
  user,
  initialTextScale,
}: {
  user: ShellUser;
  initialTextScale: TextScale;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [textScale, setTextScale] = useState(initialTextScale);
  const role = roleOf(user);
  const isSuperAdmin = role === "super_admin";
  const isRowAdmin = role === "admin";
  const companies = useQuery({
    ...trpc.company.options.queryOptions(),
    enabled: open,
  });
  const companyName = companies.data?.companies.find(
    (item) => item.id === companies.data?.activeId,
  )?.name;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" aria-label={t.users.myAccount} />}
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-medium">
          {initials(user.name)}
        </span>
        <span className="hidden sm:inline">{user.name}</span>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={8}
        aria-label={t.users.myAccount}
        className="w-[min(24rem,calc(100vw-1.5rem))] max-w-none p-0"
      >
        <div className="flex items-start gap-3 border-b px-4 py-4">
          <div
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold"
          >
            {initials(user.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={isSuperAdmin ? "default" : isRowAdmin ? "secondary" : "outline"}>
                {isSuperAdmin
                  ? t.users.roleSuperAdmin
                  : isRowAdmin
                    ? t.users.roleAdmin
                    : t.users.roleUser}
              </Badge>
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="size-3.5" />
                <span className="truncate">{companyName ?? "—"}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="max-h-[min(30rem,calc(100svh-5rem))] space-y-5 overflow-y-auto p-4">
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Accessibility className="size-3.5" />
              {t.settings.textSize}
            </p>
            <Preference<TextScale>
              label={t.settings.textSize}
              value={textScale}
              options={[
                { value: "normal", label: t.settings.textSizeNormal },
                { value: "large", label: t.settings.textSizeLarge },
              ]}
              onSelect={(value) => {
                setTextScale(value);
                setTextScaleCookie(value);
                document.documentElement.classList.toggle("a11y-large-text", value === "large");
              }}
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Languages className="size-3.5" />
              {t.settings.language}
            </p>
            <Preference<Locale>
              label={t.settings.language}
              value={locale}
              options={[
                { value: "en", label: t.settings.english },
                { value: "id", label: t.settings.indonesian },
              ]}
              onSelect={setLocaleCookie}
            />
          </div>
        </div>

        <div className="grid gap-2 border-t p-3 sm:grid-cols-2">
          <Link
            href="/change-password"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            onClick={() => setOpen(false)}
          >
            <KeyRound />
            {t.password.changeTitle}
          </Link>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setOpen(false);
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    queryClient.clear();
                    router.push("/login");
                    router.refresh();
                  },
                },
              });
            }}
          >
            <LogOut />
            {t.auth.signOut}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
