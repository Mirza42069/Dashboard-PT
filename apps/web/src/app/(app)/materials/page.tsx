import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requirePermission } from "@/lib/session";

import MaterialsTable from "./materials-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.materials.title} · ${BRAND_NAME}` };
}

export default async function MaterialsPage() {
  // Nav hides this link from Users, but the URL is still typeable — gate the
  // page itself, not just the link.
  const session = await requirePermission("material:read");
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      {/* sr-only, not deleted: the sidebar already names the page, so the
          heading was visual duplication — but the document still needs an h1,
          and it is what a screen reader announces on navigation. */}
      <h1 className="sr-only">{dict.materials.title}</h1>

      <MaterialsTable canManage={hasPermission(roleOf(session.user), "material:manage")} />
    </div>
  );
}
