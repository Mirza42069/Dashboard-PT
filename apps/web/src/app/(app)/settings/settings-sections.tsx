"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Label } from "@DashboardV2/ui/components/label";
import { Separator } from "@DashboardV2/ui/components/separator";
import { Moon, Sun } from "lucide-react";

import ChangePasswordForm from "@/components/change-password-form";
import type { Locale } from "@/i18n";
import { setLocaleCookie, useLocale, useT } from "@/i18n/provider";
import { setThemeCookie, type Theme } from "@/lib/theme";

export function LanguageSection() {
  const t = useT();
  const { locale } = useLocale();

  const options: { value: Locale; label: string }[] = [
    { value: "en", label: t.settings.english },
    { value: "id", label: t.settings.indonesian },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.language}</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            variant={locale === option.value ? "default" : "outline"}
            onClick={() => {
              if (locale !== option.value) setLocaleCookie(option.value);
            }}
          >
            {option.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

export function AppearanceSection({ theme }: { theme: Theme }) {
  const t = useT();

  const options = [
    { value: "light", label: t.settings.light, icon: Sun },
    { value: "dark", label: t.settings.dark, icon: Moon },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.appearance}</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-2">
        {options.map(({ value, label, icon: Icon }) => (
          <Button
            key={value}
            variant={theme === value ? "default" : "outline"}
            onClick={() => {
              if (theme === value) return;
              setThemeCookie(value);
              // Reload rather than toggling a class: the theme lives on <html>
              // from the server, so a reload keeps client and server agreeing
              // and avoids a second source of truth.
              window.location.reload();
            }}
          >
            <Icon />
            {label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

export function AccountSection({
  name,
  email,
  role,
}: {
  name: string;
  email: string;
  role: string;
}) {
  const t = useT();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.account}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <Label>{t.settings.name}</Label>
            <p className="mt-1 font-medium">{name}</p>
          </div>
          <div>
            <Label>{t.users.email}</Label>
            <p className="mt-1 font-medium">{email}</p>
          </div>
          <div>
            <Label>{t.settings.role}</Label>
            <p className="mt-1">
              <Badge variant={role === "admin" ? "default" : "outline"}>
                {role === "admin" ? t.users.roleAdmin : t.users.roleUser}
              </Badge>
            </p>
          </div>
        </div>

        <Separator />

        <div className="max-w-sm space-y-3">
          <p className="text-sm font-medium">{t.password.changeTitle}</p>
          <ChangePasswordForm />
        </div>
      </CardContent>
    </Card>
  );
}
