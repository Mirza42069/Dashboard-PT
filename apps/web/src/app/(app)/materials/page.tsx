import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";

import MaterialsTable from "./materials-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.materials.title} · ${BRAND_NAME}` };
}

export default async function MaterialsPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* sr-only, not deleted: the sidebar already names the page, so the
          heading was visual duplication — but the document still needs an h1,
          and it is what a screen reader announces on navigation. */}
      <h1 className="sr-only">{dict.materials.title}</h1>

      <MaterialsTable isAdmin={session.user.role === "admin"} />
    </div>
  );
}
