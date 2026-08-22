"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

import { AttentionList, type AttentionFilter } from "./attention-list";
import { FilterCards } from "./filter-cards";

/**
 * Must match the prefetch in ./page.tsx exactly.
 *
 * The server hands down an infinite-query cache entry keyed on this input; a
 * different filter or page size here is a different key, and the page silently
 * refetches everything on load instead of painting from what it was given.
 */
export const EXCEPTIONS_PAGE_SIZE = 25;

/**
 * The dashboard, as four bands.
 *
 * This component owns the three queries and the filter, and nothing else — each
 * band takes its data as props so it can be read on its own. That split is the
 * point: what this replaced was one 514-line file where the portfolio figures,
 * the exception table and its seven-badge rows all shared a scope.
 */
export default function DashboardOverview({ canReview }: { canReview: boolean }) {
  const t = useT();
  const [filter, setFilter] = useState<AttentionFilter>("all");

  const summary = useQuery(trpc.project.summary.queryOptions());

  const exceptionsKey = trpc.project.exceptions.queryOptions({
    filter,
    limit: EXCEPTIONS_PAGE_SIZE,
    offset: 0,
  });
  const exceptions = useInfiniteQuery({
    queryKey: exceptionsKey.queryKey,
    initialPageParam: 0,
    queryFn: (context) => {
      const page = trpc.project.exceptions.queryOptions({
        filter,
        limit: EXCEPTIONS_PAGE_SIZE,
        offset: context.pageParam,
      });
      if (typeof page.queryFn !== "function") throw new Error("Missing exceptions query");
      return page.queryFn({ ...context, queryKey: page.queryKey } as never);
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });

  const firstPage = exceptions.data?.pages[0];
  const rows = exceptions.data?.pages.flatMap((page) => page.projects) ?? [];
  const exceptionsError = exceptions.isError && exceptions.data === undefined;

  const pending = summary.isPending || exceptions.isPending;

  return (
    <div className="space-y-4">
      <p className="sr-only" role="status" aria-live="polite">
        {pending
          ? t.dashboard.loading
          : summary.isError || exceptionsError
            ? t.common.loadFailed
            : t.dashboard.loaded}
      </p>

      {/*
        The counts come from the unfiltered page-one payload, which the server
        returns identically on every page and for every filter — so the cards
        keep stating the whole picture while one of them is pressed, and a card
        does not vanish just because the filter narrowed the list past it.
      */}
      <FilterCards
        counts={firstPage?.counts}
        live={firstPage?.counts.live}
        active={filter}
        onSelect={setFilter}
        canReview={canReview}
        pending={exceptions.isPending}
        portfolioValue={summary.data?.portfolioValue}
        completionPercent={summary.data?.valueCompletionPercent}
        summaryPending={summary.isPending}
      />

      <AttentionList
        rows={rows}
        total={firstPage?.total ?? 0}
        filter={filter}
        onFilterChange={setFilter}
        pending={exceptions.isPending}
        error={exceptionsError ? exceptions.error : null}
        onRetry={() => void exceptions.refetch()}
        hasNextPage={exceptions.hasNextPage}
        isFetchingNextPage={exceptions.isFetchingNextPage}
        isFetchNextPageError={exceptions.isFetchNextPageError}
        onLoadMore={() => void exceptions.fetchNextPage()}
      />
    </div>
  );
}
