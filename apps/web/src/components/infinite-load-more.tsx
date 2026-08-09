"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Loader2 } from "@DashboardV2/ui/components/icons";
import { useEffect, useEffectEvent, useRef } from "react";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";

export function InfiniteLoadMore({
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  loadedCount,
  total,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  loadedCount: number;
  total: number;
  onLoadMore: () => void;
}) {
  const t = useT();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMore = useEffectEvent(onLoadMore);

  useEffect(() => {
    const node = sentinelRef.current;
    if (
      !node ||
      !("IntersectionObserver" in window) ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }

    // AppShell owns vertical scrolling in #main; using it as the root also makes
    // short first pages auto-fill without relying on the browser viewport.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { root: document.getElementById("main"), rootMargin: "0px 0px 240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError]);

  if (loadedCount === 0) return null;

  return (
    <div ref={sentinelRef} className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {interpolate(t.common.loadedCount, { count: loadedCount, total })}
        {isFetchingNextPage
          ? ` · ${t.common.loadingMore}`
          : !hasNextPage
            ? ` · ${t.common.endOfResults}`
            : ""}
      </p>

      {isFetchNextPageError && (
        <p role="alert" className="text-sm text-destructive">
          {t.common.loadMoreFailed}
        </p>
      )}

      {hasNextPage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
        >
          {isFetchingNextPage && <Loader2 className="animate-spin" />}
          {isFetchingNextPage
            ? t.common.loadingMore
            : isFetchNextPageError
              ? t.common.retry
              : t.common.loadMore}
        </Button>
      )}
    </div>
  );
}
