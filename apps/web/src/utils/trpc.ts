import type { AppRouter } from "@DashboardV2/api/routers/index";
import { env } from "@DashboardV2/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "@/lib/toast";

import { getServerUrl } from "@/lib/server-url";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Without this every remount refetches, so moving between pages and back
      // re-runs the whole list query for data that is seconds old. Mutations
      // call invalidateQueries explicitly, which ignores staleTime, so edits
      // still show up immediately — this only suppresses the redundant refetch
      // on navigation and on window focus.
      staleTime: 30_000,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: () => {
            query.invalidate();
          },
        },
      });
    },
  }),
});

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: "include",
        });
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
