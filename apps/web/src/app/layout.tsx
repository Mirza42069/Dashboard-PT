import { cn } from "@DashboardV2/ui/lib/utils";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";

import "../index.css";
import { BRAND_NAME } from "@/components/brand";
import { SITE_URL } from "@/lib/site";
import Providers from "@/components/providers";
import { getDictionary, getLocale } from "@/i18n";
import { getTextScale, TEXT_SCALE_CLASS } from "@/lib/text-scale";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: BRAND_NAME,
    robots: { index: false, follow: false },
    title: BRAND_NAME,
    description: dict.auth.tagline,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, textScale] = await Promise.all([
    getLocale(),
    getTextScale(),
  ]);

  return (
    // Language and text scale come from cookies read on the server,
    // so the first byte of HTML is already correct — no flash, and no
    // client-side script rewriting the class after paint.
    //
    // No next/font here: the theme owns typography via --font-sans / --font-mono
    // in packages/ui/src/styles/globals.css, which `body { @apply font-sans }`
    // applies.
    <html
      lang={locale}
      className={cn("light", TEXT_SCALE_CLASS[textScale])}
      style={{ colorScheme: "light" }}
    >
      <body className="antialiased">
        {/* Chrome lives in app/(app)/layout.tsx — /login and /change-password
            render bare so they cannot show navigation to pages you can't open. */}
        <Providers locale={locale}>
          {children}
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
