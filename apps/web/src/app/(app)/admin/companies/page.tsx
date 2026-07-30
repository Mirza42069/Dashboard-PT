import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requirePermission } from "@/lib/session";

import CompaniesTable from "./companies-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.company.title} - ${BRAND_NAME}` };
}

export default async function AdminCompaniesPage() {
  await requirePermission("company:manage");
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="sr-only">{dict.company.title}</h1>

      <CompaniesTable />
    </div>
  );
}
