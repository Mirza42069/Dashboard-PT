import type { Metadata } from "next";

import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  alternates: {
    canonical: "/privacy",
    languages: { id: "/privacy", en: "/en/privacy" },
  },
};

export default function PrivacyPage() {
  return <LegalPage locale="id" kind="privacy" />;
}
