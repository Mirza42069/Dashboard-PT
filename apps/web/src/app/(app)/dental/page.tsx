import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";

import DentalDashboardClient from "./dashboard-client";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dental.dashboardTitle} - ${BRAND_NAME}` };
}

export default function DentalDashboardPage() {
  return <DentalDashboardClient />;
}
