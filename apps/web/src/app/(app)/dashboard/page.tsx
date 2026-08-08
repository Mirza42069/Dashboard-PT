import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { getCompanyScope, requireSession } from "@/lib/session";

import DashboardOverview from "./dashboard-overview";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dashboard.title} - ${BRAND_NAME}` };
}

export default async function DashboardPage() {
  const [session, scope] = await Promise.all([requireSession(), getCompanyScope()]);
  if (scope.vertical === "dental") redirect("/dental" as Route);
  const role = roleOf(session.user);
  const dict = getDictionary(await getLocale());

  return (
    <div className="p-4 md:p-6">
      <h1 className="sr-only">{dict.dashboard.title}</h1>
      <DashboardOverview canReview={hasPermission(role, "progress:review")} />
    </div>
  );
}
