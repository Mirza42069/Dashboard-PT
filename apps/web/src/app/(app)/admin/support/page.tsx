import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requirePermission } from "@/lib/session";

import SupportInbox from "./support-inbox";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.support.inboxTitle} - ${BRAND_NAME}` };
}

export default async function SupportPage() {
  await requirePermission("support:manage");

  return (
    <div className="flex h-full min-h-0 flex-col p-0 md:p-6">
      <SupportInbox />
    </div>
  );
}
