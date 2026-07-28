import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireAdmin } from "@/lib/session";

import UsersTable from "./users-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.users.title} · ${BRAND_NAME}` };
}

export default async function AdminUsersPage() {
  const session = await requireAdmin();
  const dict = getDictionary(await getLocale());

  return (
    <div className="space-y-4 p-4 md:p-6">
      <h1 className="sr-only">{dict.users.title}</h1>

      <UsersTable currentUserId={session.user.id} />
    </div>
  );
}
