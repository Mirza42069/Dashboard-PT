import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getTheme } from "@/lib/theme";

import { AccountSection, AppearanceSection, LanguageSection } from "./settings-sections";

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

      <div className="max-w-2xl space-y-4">
        <LanguageSection />
        <AppearanceSection theme={await getTheme()} />
        <AccountSection
          name={session.user.name}
          email={session.user.email}
          role={session.user.role ?? "user"}
        />
      </div>
    </div>
  );
}
