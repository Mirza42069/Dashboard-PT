import "server-only";

import type { AppRouter } from "@DashboardV2/api/routers/index";
import { env } from "@DashboardV2/env/web";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { headers } from "next/headers";
import { cache } from "react";

import { getServerUrl } from "@/lib/server-url";

import { makeQueryClient } from "./query-client";

export const getQueryClient = cache(makeQueryClient);

export const getTRPC = cache(() => {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/trpc`,
        async headers() {
          const requestHeaders = await headers();
          const forwarded: Record<string, string> = {};

          for (const name of ["cookie", "authorization"]) {
            const value = requestHeaders.get(name);
            if (value) forwarded[name] = value;
          }

          return forwarded;
        },
        fetch(url, options) {
          return fetch(url, { ...options, cache: "no-store" });
        },
      }),
    ],
  });

  return createTRPCOptionsProxy<AppRouter>({
    client,
    queryClient: getQueryClient,
  });
});

export function HydrateClient({ children }: { children: React.ReactNode }) {
  return (
    <HydrationBoundary state={dehydrate(getQueryClient())}>
      {children}
    </HydrationBoundary>
  );
}
