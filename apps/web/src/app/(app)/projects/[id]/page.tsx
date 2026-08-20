import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getQueryClient, getTRPC, HydrateClient } from "@/utils/trpc-server";

import ProjectDetail from "./project-detail";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.projects.project} - ${BRAND_NAME}` };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[]; action?: string | string[] }>;
}) {
  const session = await requireSession();
  const role = roleOf(session.user);
  const { id } = await params;
  const canManageMembers = hasPermission(role, "member:manage");
  const requested = await searchParams;
  const requestedTab = Array.isArray(requested.tab) ? requested.tab[0] : requested.tab;
  // Mirrors PROJECT_TABS in ./project-detail.tsx.
  const tabs = ["overview", "tickets", "baseline", "boq", "schedule", "progress", "daily", "notes", "team"];
  const activeTab =
    requestedTab && tabs.includes(requestedTab) && (requestedTab !== "team" || canManageMembers)
      ? requestedTab
      : "overview";
  const actionValue = Array.isArray(requested.action) ? requested.action[0] : requested.action;
  const queryClient = getQueryClient();
  const trpc = getTRPC();
  const prefetches: Promise<void>[] = [
    queryClient.prefetchQuery(trpc.project.get.queryOptions({ id })),
  ];

  if (activeTab === "overview") {
    prefetches.push(
      queryClient.prefetchQuery(trpc.progress.workStages.queryOptions({ projectId: id })),
    );
  } else if (activeTab === "tickets") {
    prefetches.push(
      queryClient.prefetchInfiniteQuery(
        trpc.ticket.listByProject.infiniteQueryOptions(
          {
            projectId: id,
            search: "",
            status: undefined,
            focusId: actionValue ?? undefined,
            limit: 25,
          },
          { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
        ),
      ),
    );
  } else if (activeTab === "baseline" || activeTab === "boq" || activeTab === "schedule") {
    // All three render BaselineTab, which opens on listVersions either way.
    prefetches.push(
      queryClient.prefetchQuery(trpc.boq.listVersions.queryOptions({ projectId: id })),
    );
  } else if (activeTab === "daily") {
    prefetches.push(
      queryClient.prefetchQuery(
        trpc.dailyReport.list.queryOptions({
          projectId: id,
          status: undefined,
          from: undefined,
          to: undefined,
          limit: 30,
          offset: 0,
        }),
      ),
    );
  }

  await Promise.all(prefetches);

  return (
    <HydrateClient>
      <div className="p-4 md:p-6">
        <ProjectDetail
          projectId={id}
          currentUserId={session.user.id}
          canUpdateProject={hasPermission(role, "project:update")}
          canWrite={hasPermission(role, "project:write")}
          canManageMembers={canManageMembers}
          // Resolved here, on the server, from the same permission map the API
          // gates the transitions with. The UI hiding a button is a courtesy; the
          // procedure refusing the move is the control.
          canReview={hasPermission(role, "progress:review")}
          canLock={hasPermission(role, "progress:lock")}
        />
      </div>
    </HydrateClient>
  );
}
