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
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-5 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{dict.support.inboxTitle}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{dict.support.inboxDescription}</p>
      </div>
      <SupportInbox />
    </div>
  );
}
