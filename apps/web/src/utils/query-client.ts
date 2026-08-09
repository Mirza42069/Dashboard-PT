import { QueryClient, type QueryCache } from "@tanstack/react-query";

export function makeQueryClient(queryCache?: QueryCache) {
  return new QueryClient({
    queryCache,
    defaultOptions: {
      queries: {
        // Mutations invalidate explicitly; this only avoids redundant refetches
        // while navigating between views of data that is still seconds old.
        staleTime: 30_000,
      },
    },
  });
}
