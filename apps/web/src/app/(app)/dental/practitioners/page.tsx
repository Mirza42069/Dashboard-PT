import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requirePermission } from "@/lib/session";

import PractitionersClient from "./practitioners-client";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dental.practitionersTitle} - ${BRAND_NAME}` };
}

export default async function PractitionersPage() {
  await requirePermission("dental:settings");
  return <PractitionersClient />;
}
