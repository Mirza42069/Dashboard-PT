"use client";

import { roleOf } from "@DashboardV2/api/lib/permissions";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  KeyRound,
  Languages,
  Moon,
  Palette,
  SlidersHorizontal,
  Sun,
  UserRound,
} from "lucide-react";

import ChangePasswordForm from "@/components/change-password-form";
import type { Locale } from "@/i18n";
import { setLocaleCookie, useLocale, useT } from "@/i18n/provider";
import { setThemeCookie, type Theme } from "@/lib/theme";
import { trpc } from "@/utils/trpc";

/**
 * Shared tile chrome. Every settings card is the same object at a different
 * size, so the header — icon, title — is defined once rather than per section.
 * `h-full` lets a tile fill whatever cell the bento grid gives it, which is
 * what keeps two tiles sharing a row the same height.
 */
function Tile({
  title,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  icon: typeof UserRound;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Label above value, used for every read-only field in the profile tile. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-[0.6875rem] font-medium tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <div className="truncate text-sm font-medium">{children}</div>
    </div>
  );
}

/**
 * A two-option segmented control. Both settings pages below pick one of two
 * values, and full-width halves make the current choice obvious at a glance —
 * the previous inline buttons left most of the card empty.
 */
function Segmented<T extends string>({
  options,
  value,
  onSelect,
}: {
  options: { value: T; label: string; icon?: typeof Sun }[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((option) => (
        <Button
          key={option.value}
          variant={value === option.value ? "default" : "outline"}
          aria-pressed={value === option.value}
          className="w-full"
          onClick={() => {
            if (value !== option.value) onSelect(option.value);
          }}
        >
          {option.icon ? <option.icon /> : null}
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function ProfileSection({
  name,
  email,
  role,
  className,
}: {
  name: string;
  email: string;
  role: string;
  className?: string;
}) {
  const t = useT();
  const normalizedRole = roleOf({ role });
  const isSuperAdmin = normalizedRole === "super_admin";
  const isRowAdmin = normalizedRole === "admin";

  // The company the account is acting as — their own, or for a super admin
  // whichever one the header switcher currently points at.
  const options = useQuery(trpc.company.options.queryOptions());
  const companyName = options.data?.companies.find(
    (item) => item.id === options.data?.activeId,
  )?.name;

  return (
    <Tile title={t.settings.account} icon={UserRound} className={className}>
      <div className="flex items-center gap-3 pb-4">
        <div
          aria-hidden
          className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold"
        >
          {name.charAt(0).toUpperCase()}
        </div>
        <p className="min-w-0 truncate font-medium">{name}</p>
      </div>

      {/* Email lives here rather than under the name: shown once, it earns a
          column and the row fills the tile instead of half of it. */}
      <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
        <Field label={t.users.email}>
          <span className="truncate">{email}</span>
        </Field>
        <Field label={t.settings.role}>
          <Badge variant={isSuperAdmin ? "default" : isRowAdmin ? "secondary" : "outline"}>
            {isSuperAdmin ? t.users.roleSuperAdmin : isRowAdmin ? t.users.roleAdmin : t.users.roleUser}
          </Badge>
        </Field>
        <Field label={t.company.label}>
          <span className="flex items-center gap-1.5">
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{companyName ?? "—"}</span>
          </span>
        </Field>
      </div>
    </Tile>
  );
}

/**
 * Appearance and language share a tile rather than getting one each. Alone,
 * either is a single row of two buttons — beside the taller profile tile the
 * grid would stretch them and leave the extra height blank. Together they fill
 * the column, and they belong together anyway: both are display preferences.
 */
export function PreferencesSection({
  theme,
  className,
}: {
  theme: Theme;
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();

  // Tile icon is deliberately not Palette: that belongs to the Appearance row
  // below, and using it here too put the same icon twice in one card, which read
  // as two headings for the same section. The tile covers appearance *and*
  // language, so it takes the generic control icon and lets each row keep its own.
  return (
    <Tile title={t.settings.preferences} icon={SlidersHorizontal} className={className}>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Palette className="size-3.5 shrink-0" />
            {t.settings.appearance}
          </p>
          <Segmented
            value={theme}
            options={[
              { value: "light", label: t.settings.light, icon: Sun },
              { value: "dark", label: t.settings.dark, icon: Moon },
            ]}
            onSelect={(value) => {
              setThemeCookie(value);
              // Reload rather than toggling a class: the theme lives on <html>
              // from the server, so a reload keeps client and server agreeing
              // and avoids a second source of truth.
              window.location.reload();
            }}
          />
        </div>

        <div className="space-y-2 border-t pt-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Languages className="size-3.5 shrink-0" />
            {t.settings.language}
          </p>
          <Segmented<Locale>
            value={locale}
            options={[
              { value: "en", label: t.settings.english },
              { value: "id", label: t.settings.indonesian },
            ]}
            onSelect={setLocaleCookie}
          />
        </div>
      </div>
    </Tile>
  );
}

export function PasswordSection({ className }: { className?: string }) {
  const t = useT();

  return (
    <Tile title={t.password.changeTitle} icon={KeyRound} className={className}>
      <ChangePasswordForm horizontal />
    </Tile>
  );
}
