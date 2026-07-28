import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireAdmin } from "@/lib/session";

import CompaniesTable from "./companies-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.company.title} · ${BRAND_NAME}` };
}

export default async function AdminCompaniesPage() {
  await requireAdmin();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight">{dict.company.title}</h1>
        <p className="text-sm text-muted-foreground">{dict.company.subtitle}</p>
      </div>

      <CompaniesTable />
    </div>
  );
}
