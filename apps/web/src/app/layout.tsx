import type { Metadata } from "next";

import "../index.css";
import { BRAND_NAME } from "@/components/brand";
import Providers from "@/components/providers";
import { getDictionary, getLocale } from "@/i18n";
import { getTheme } from "@/lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return {
    title: BRAND_NAME,
    description: dict.auth.tagline,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);

  return (
    // Theme and language both come from cookies read on the server, so the
    // first byte of HTML is already correct — no flash, and no client-side
    // script rewriting the class after paint.
    //
    // No next/font here: the theme owns typography via --font-sans / --font-mono
    // in packages/ui/src/styles/globals.css, which `body { @apply font-sans }`
    // applies.
    <html lang={locale} className={theme} style={{ colorScheme: theme }}>
      <body className="antialiased">
        {/* Chrome lives in app/(app)/layout.tsx — /login and /change-password
            render bare so they cannot show navigation to pages you can't open. */}
        <Providers locale={locale} theme={theme}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
