import { hasPermission, roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getQueryClient, getTRPC, HydrateClient } from "@/utils/trpc-server";

import DashboardOverview from "./dashboard-overview";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.dashboard.title} - ${BRAND_NAME}` };
}

export default async function DashboardPage() {
  const session = await requireSession();
  const role = roleOf(session.user);
  const dict = getDictionary(await getLocale());
  const queryClient = getQueryClient();
  const trpc = getTRPC();
  const exceptionsInput = { filter: "all" as const, limit: 25, offset: 0 };
  const initialExceptions = trpc.project.exceptions.queryOptions(exceptionsInput);

  await Promise.all([
    queryClient.prefetchQuery(trpc.project.summary.queryOptions()),
    queryClient.prefetchInfiniteQuery({
      queryKey: initialExceptions.queryKey,
      initialPageParam: 0,
      queryFn: (context) => {
        const pageQuery = trpc.project.exceptions.queryOptions({
          ...exceptionsInput,
          offset: context.pageParam,
        });
        if (typeof pageQuery.queryFn !== "function") {
          throw new Error("Missing exceptions query");
        }
        return pageQuery.queryFn({ ...context, queryKey: pageQuery.queryKey } as never);
      },
      getNextPageParam: (lastPage: { nextOffset: number | null }) =>
        lastPage.nextOffset ?? undefined,
    }),
  ]);

  return (
    <HydrateClient>
      <div className="p-4 md:p-6">
        <h1 className="sr-only">{dict.dashboard.title}</h1>
        <DashboardOverview canReview={hasPermission(role, "progress:review")} />
      </div>
    </HydrateClient>
  );
}
