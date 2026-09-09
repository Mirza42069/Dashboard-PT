"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Languages } from "@DashboardV2/ui/components/icons";

import { setLocaleCookie, useLocale, useT } from "@/i18n/provider";

export default function LanguageSwitcher() {
  const { locale } = useLocale();
  const t = useT();
  const nextLocale = locale === "id" ? "en" : "id";
  const label = nextLocale === "en" ? "English" : "Bahasa Indonesia";

  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-10"
      aria-label={`${t.settings.language}: ${label}`}
      onClick={() => setLocaleCookie(nextLocale)}
    >
      <Languages aria-hidden="true" />
      <span lang={nextLocale}>{label}</span>
    </Button>
  );
}
