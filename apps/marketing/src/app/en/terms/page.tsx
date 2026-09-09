import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  alternates: {
    canonical: "/en/terms",
    languages: { id: "/terms", en: "/en/terms" },
  },
};

export default function TermsPage() {
  return <LegalPage locale="en" kind="terms" />;
}
