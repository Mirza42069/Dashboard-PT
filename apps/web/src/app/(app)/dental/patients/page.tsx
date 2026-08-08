import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import PatientsClient from "./patients-client";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dental.patientsTitle} - ${BRAND_NAME}` };
}

export default async function PatientsPage() {
  const session = await requireSession();
  return <PatientsClient canWrite={hasPermission(roleOf(session.user), "dental:write")} />;
}
