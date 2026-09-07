import "server-only";

import { createContextFromSession } from "@DashboardV2/api/context";
import { appRouter } from "@DashboardV2/api/routers/index";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache } from "react";

import { getSession } from "@/lib/session";

import { makeQueryClient } from "./query-client";

export const getQueryClient = cache(makeQueryClient);

// Share the lazy tenant resolver across prefetches, only for this render request.
const getContext = cache(async () => {
  const [requestHeaders, session] = await Promise.all([headers(), getSession()]);
  return createContextFromSession({ headers: requestHeaders, session });
});

export const getTRPC = cache(() =>
  createTRPCOptionsProxy({
    router: appRouter,
    ctx: getContext,
    queryClient: getQueryClient,
  }),
);

export function HydrateClient({ children }: { children: React.ReactNode }) {
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      {children}
    </HydrationBoundary>
  );
}
