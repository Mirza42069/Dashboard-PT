import type { Locale } from "@/lib/content";
import { localeHref } from "@/lib/content";

import { Brand } from "./brand";

export function LegalPage({ locale, kind }: { locale: Locale; kind: "privacy" | "terms" }) {
  const isId = locale === "id";
  const title = kind === "privacy" ? (isId ? "Privasi" : "Privacy") : (isId ? "Ketentuan layanan" : "Terms of service");
  const placeholder = isId
    ? "Dokumen ini adalah placeholder sebelum peluncuran. Identitas badan usaha, alamat kontak, kebijakan penyimpanan data, dan ketentuan komersial harus ditinjau dan dilengkapi sebelum domain publik dipromosikan."
    : "This document is a pre-launch placeholder. Legal entity details, contact address, data retention policy, and commercial terms must be reviewed and completed before the public domain is promoted.";
  return (
    <main className="legal-page" lang={locale}>
      <a href={localeHref(locale)}><Brand /></a>
      <article>
        <p className="eyebrow"><span />PRE-LAUNCH</p>
        <h1>{title}</h1>
        <p>{placeholder}</p>
        <p>{isId ? "Jangan gunakan halaman ini sebagai nasihat hukum atau kebijakan final." : "Do not treat this page as legal advice or a final policy."}</p>
      </article>
    </main>
  );
}
