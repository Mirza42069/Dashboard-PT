import type { Metadata } from "next";

import { LandingPage } from "@/components/landing-page";
import { content } from "@/lib/content";

/*
 * Pinned static: lib/shots.ts resolves the screenshots from public/ with node:fs
 * at render time, which is only valid while prerendering. Going dynamic would
 * silently fall back to placeholder frames.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  // `absolute` bypasses the layout template; a plain string would render
  // "Fushin | Kontrol progres konstruksi | Fushin".
  title: { absolute: "Fushin | Kontrol progres konstruksi" },
  description: content.id.hero.body,
  alternates: { canonical: "/", languages: { id: "/", en: "/en" } },
  openGraph: { locale: "id_ID", alternateLocale: "en_US" },
};

export default function HomePage() {
  return <LandingPage t={content.id} />;
}
