import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getQueryClient, getTRPC, HydrateClient } from "@/utils/trpc-server";

import ArchiveTable from "./archive-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.archive.title} - ${BRAND_NAME}` };
}

export default async function ArchivePage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());
  const role = roleOf(session.user);

  // The sidebar already hides this entry without the permission; this is the
  // part that matters, because a typed URL does not consult the sidebar.
  // notFound rather than a redirect: someone without the permission should not
  // learn that the page exists.
  if (!hasPermission(role, "project:delete")) notFound();

  const queryClient = getQueryClient();
  const trpc = getTRPC();

  await queryClient.prefetchInfiniteQuery(
    trpc.project.list.infiniteQueryOptions(
      { search: "", archived: true, limit: 25 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );

  return (
    <HydrateClient>
      <div className="space-y-4 p-4 md:p-6">
        <h1 className="sr-only">{dict.archive.title}</h1>

        <ArchiveTable canDelete={hasPermission(role, "project:delete")} />
      </div>
    </HydrateClient>
  );
}
