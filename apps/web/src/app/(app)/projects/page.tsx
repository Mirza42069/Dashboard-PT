import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getQueryClient, getTRPC, HydrateClient } from "@/utils/trpc-server";

import { PROJECT_STATUSES } from "./project-form-values";
import ProjectsTable from "./projects-table";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.projects.title} - ${BRAND_NAME}` };
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());
  const role = roleOf(session.user);
  const params = await searchParams;
  const requestedStatus = params.status;
  const statusValue = Array.isArray(requestedStatus) ? requestedStatus[0] : requestedStatus;
  const status = PROJECT_STATUSES.find((value) => value === statusValue);
  const queryClient = getQueryClient();
  const trpc = getTRPC();

  await queryClient.prefetchInfiniteQuery(
    trpc.project.list.infiniteQueryOptions(
      { search: "", status, limit: 25 },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );

  return (
    <HydrateClient>
      <div className="space-y-4 p-4 md:p-6">
        <h1 className="sr-only">{dict.projects.title}</h1>

        <ProjectsTable
          canCreate={hasPermission(role, "project:create")}
          canDelete={hasPermission(role, "project:delete")}
          canManageMembers={hasPermission(role, "member:manage")}
          currentUserId={session.user.id}
          // Off the already-verified session rather than a browser useSession()
          // — same reason as (app)/layout.tsx. Null for a normal account, which
          // is what "no limit" looks like here.
          trialAiCredits={session.user.trialAiCredits ?? null}
        />
      </div>
    </HydrateClient>
  );
}
