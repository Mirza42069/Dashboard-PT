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
  title: { absolute: "Fushin | Construction progress control" },
  description: content.en.hero.body,
  alternates: { canonical: "/en", languages: { id: "/", en: "/en" } },
  openGraph: { locale: "en_US", alternateLocale: "id_ID" },
};

export default function EnglishHomePage() {
  return <LandingPage t={content.en} />;
}
