import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";

import "./globals.css";
import { SITE_URL } from "@/lib/site";

/**
 * Typography is scoped to this site. The dashboard deliberately ships no
 * webfonts (see apps/web/src/app/layout.tsx), and that stays true — these are
 * self-hosted by next/font and never requested by the product.
 *
 * Roles: Geist for headings, Inter for body copy, Geist Mono for figures and
 * micro-labels.
 */
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-face",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Fushin AI | Kontrol progres konstruksi", template: "%s | Fushin AI" },
  description: "Kontrol progres konstruksi dari baseline BoQ hingga review, persetujuan, dan keputusan proyek.",
  applicationName: "Fushin AI",
  alternates: { canonical: "/", languages: { id: "/", en: "/en" } },
  openGraph: { type: "website", siteName: "Fushin AI", locale: "id_ID", alternateLocale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${geist.variable} ${inter.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
