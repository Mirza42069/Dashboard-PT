import { roleOf } from "@DashboardV2/api/lib/permissions";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BRAND_NAME } from "@/components/brand";
import { getDictionary, getLocale } from "@/i18n";
import { requireSession } from "@/lib/session";
import { getQueryClient, getTRPC, HydrateClient } from "@/utils/trpc-server";

import SupportThreads from "./support-threads";

export async function generateMetadata(): Promise<Metadata> {
  const dict = getDictionary(await getLocale());
  return { title: `${dict.support.myRequests} - ${BRAND_NAME}` };
}

export default async function MySupportPage() {
  const session = await requireSession();
  const dict = getDictionary(await getLocale());

  // System accounts cannot file a request (support.submit refuses them), so
  // this page would only ever show them an empty list. Their support surface is
  // the global inbox at /admin/support, which the nav already points them to.
  if (roleOf(session.user) === "super_admin") notFound();

  const queryClient = getQueryClient();
  const trpc = getTRPC();
  await queryClient.prefetchQuery(trpc.support.myRequests.queryOptions());

  return (
    <HydrateClient>
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">{dict.support.myRequests}</h1>
          <p className="text-sm text-muted-foreground">{dict.support.myRequestsDescription}</p>
        </div>
        <SupportThreads currentUserId={session.user.id} />
      </div>
    </HydrateClient>
  );
}
