import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getTheme } from "@/lib/theme";

import { PasswordSection, PreferencesSection, ProfileSection } from "./settings-sections";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.settings.title} · ${BRAND_NAME}` };
}

export default async function SettingsPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{dict.settings.title}</h1>
      </div>

      {/*
        Bento: tiles are sized by what they hold, and every row is exactly full
        at every breakpoint — no column left hanging, no tile stretched past its
        content. One DOM order covers all three:
          3 cols: [profile 2][preferences 1] / [password 3]
          2 cols: [profile 2] / [preferences 2] / [password 2]
          1 col:  stacked
      */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileSection
          name={session.user.name}
          email={session.user.email}
          role={session.user.role ?? "user"}
          className="sm:col-span-2"
        />
        <PreferencesSection theme={await getTheme()} className="sm:col-span-2 lg:col-span-1" />
        <PasswordSection className="sm:col-span-2 lg:col-span-3" />
      </div>
    </div>
  );
}
