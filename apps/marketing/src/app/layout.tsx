import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";

import "./globals.css";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Fushin — Kontrol progres konstruksi", template: "%s — Fushin" },
  description: "Kontrol progres konstruksi dari baseline BoQ hingga review, persetujuan, dan keputusan proyek.",
  applicationName: "Fushin",
  alternates: { canonical: "/", languages: { id: "/", en: "/en" } },
  openGraph: { type: "website", siteName: "Fushin", locale: "id_ID", alternateLocale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
