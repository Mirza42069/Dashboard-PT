"use client";

import { useEffect, useState } from "react";

import type { Content } from "@/lib/content";
import { localeHref } from "@/lib/content";

import { Brand } from "./brand";

/**
 * Deliberately minimal: the mark and the language switch, nothing else.
 * There is no section nav, sign-in link, or demo CTA here by design.
 */
export function SiteHeader({ t }: { t: Content }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled || undefined}>
      <div className="nav-shell">
        <a href={localeHref(t.locale)} className="brand-link" aria-label={t.nav.home}>
          <Brand />
        </a>
        <div className="nav-actions">
          <a
            href={localeHref(t.alternateLocale)}
            className="language-link"
            lang={t.alternateLocale}
            hrefLang={t.alternateLocale}
            aria-label={t.languageName}
          >
            {t.alternateLabel}
          </a>
        </div>
      </div>
    </header>
  );
}
