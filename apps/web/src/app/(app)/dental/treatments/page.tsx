import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import TreatmentsClient from "./treatments-client";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dental.treatmentsTitle} - ${BRAND_NAME}` };
}

export default async function TreatmentsPage() {
  const session = await requireSession();
  const role = roleOf(session.user);
  return <TreatmentsClient canWrite={hasPermission(role, "dental:write")} />;
}
