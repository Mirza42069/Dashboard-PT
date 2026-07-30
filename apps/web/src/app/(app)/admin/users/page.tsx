import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { roleOf } from "@DashboardV2/api/lib/permissions";
import { getDictionary, getLocale } from "@/i18n";
import { requirePermission } from "@/lib/session";

import UsersTable from "./users-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.users.title} - ${BRAND_NAME}` };
}

export default async function AdminUsersPage() {
  const session = await requirePermission("user:manage");
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="sr-only">{dict.users.title}</h1>

      <UsersTable currentUserId={session.user.id} actorRole={roleOf(session.user)} />
    </div>
  );
}
