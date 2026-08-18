"use client";

import { useEffect, useState } from "react";

import type { Content } from "@/lib/content";
import { localeHref } from "@/lib/content";
import { APP_URL } from "@/lib/site";

import { Brand } from "./brand";
import { ArrowRight, Menu, X } from "./icons";

export function SiteHeader({ t }: { t: Content }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled || undefined} data-open={open || undefined}>
      <div className="nav-shell">
        <a
          href={localeHref(t.locale)}
          className="brand-link"
          aria-label={t.locale === "id" ? "Beranda Fushin" : "Fushin home"}
        >
          <Brand />
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#product">{t.nav.product}</a>
          <a href="#workflow">{t.nav.workflow}</a>
          <a href="#security">{t.nav.security}</a>
          <a href="#faq">{t.nav.faq}</a>
        </nav>
        <div className="nav-actions">
          <a href={localeHref(t.alternateLocale)} className="language-link" lang={t.alternateLocale}>
            {t.alternateLabel}
          </a>
          <a href={`${APP_URL}/login`} className="sign-in-link">{t.nav.signIn}</a>
          <a href="#demo" className="button button-dark button-small">
            {t.nav.demo}<ArrowRight />
          </a>
          <button
            type="button"
            className="menu-button"
            aria-label={t.nav.menu}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </div>
      <div className="mobile-nav" aria-hidden={!open}>
        <nav aria-label="Mobile navigation">
          <a href="#product" onClick={() => setOpen(false)}>{t.nav.product}</a>
          <a href="#workflow" onClick={() => setOpen(false)}>{t.nav.workflow}</a>
          <a href="#security" onClick={() => setOpen(false)}>{t.nav.security}</a>
          <a href="#faq" onClick={() => setOpen(false)}>{t.nav.faq}</a>
          <a href={`${APP_URL}/login`}>{t.nav.signIn}</a>
          <a href="#demo" className="button button-dark" onClick={() => setOpen(false)}>{t.nav.demo}<ArrowRight /></a>
        </nav>
      </div>
    </header>
  );
}
