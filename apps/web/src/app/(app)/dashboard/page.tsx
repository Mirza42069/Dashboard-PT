import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import DashboardOverview from "./dashboard-overview";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dashboard.title} · ${BRAND_NAME}` };
}

export default async function DashboardPage() {
  // Still gates the route even though the page renders nothing about the user.
  await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold tracking-tight">{dict.dashboard.title}</h1>
      <DashboardOverview />
    </div>
  );
}
