import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  alternates: {
    canonical: "/terms",
    languages: { id: "/terms", en: "/en/terms" },
  },
};

export default function TermsPage() {
  return <LegalPage locale="id" kind="terms" />;
}
