import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { resolveProjectTab } from "@/lib/project-navigation";
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
  const actionValue = Array.isArray(requested.action) ? requested.action[0] : requested.action;
  const queryClient = getQueryClient();
  const trpc = getTRPC();
  const projectOptions = trpc.project.get.queryOptions({ id });
  await queryClient.prefetchQuery(projectOptions);
  const project = queryClient.getQueryData(projectOptions.queryKey);
  const activeTab = resolveProjectTab(
    requestedTab,
    project?.hiddenModules ?? [],
    canManageMembers,
  );
  const prefetches: Promise<void>[] = [];

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
  }

  await Promise.all(prefetches);

  return (
    <HydrateClient>
      <div className="p-4 md:p-6">
        <ProjectDetail
          projectId={id}
          currentUserId={session.user.id}
          canArchive={hasPermission(role, "project:delete")}
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
