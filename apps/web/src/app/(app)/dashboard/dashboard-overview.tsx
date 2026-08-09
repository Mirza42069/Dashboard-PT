"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button, buttonVariants } from "@DashboardV2/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import {
  ChevronRight,
  Wallet,
} from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState } from "react";

import { DeviationBadge } from "@/components/deviation-badge";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
type AttentionFilter = "all" | "behind" | "reporting" | "review" | "actions";
const EXCEPTIONS_PAGE_SIZE = 25;

export default function DashboardOverview({ canReview }: { canReview: boolean }) {
  const t = useT();
  const { formatDate, money, moneyCompact, percent, quantity } = useFormat();
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const [allProblemsCount, setAllProblemsCount] = useState(0);
  const summary = useQuery(trpc.project.summary.queryOptions());
  const exceptionQuery = trpc.project.exceptions.queryOptions({
    filter: attentionFilter,
    limit: EXCEPTIONS_PAGE_SIZE,
    offset: 0,
  });
  const exceptions = useInfiniteQuery({
    queryKey: exceptionQuery.queryKey,
    initialPageParam: 0,
    queryFn: (context) => {
      const pageQuery = trpc.project.exceptions.queryOptions({
        filter: attentionFilter,
        limit: EXCEPTIONS_PAGE_SIZE,
        offset: context.pageParam,
      });
      if (typeof pageQuery.queryFn !== "function") throw new Error("Missing exceptions query");
      return pageQuery.queryFn({ ...context, queryKey: pageQuery.queryKey } as never);
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
  const dashboardPending = summary.isPending || exceptions.isPending;
  const dashboardHasError = summary.isError || (exceptions.isError && exceptions.data === undefined);

  const exceptionSummary = exceptions.data?.pages[0];
  const attentionProjects = exceptions.data?.pages.flatMap((page) => page.projects) ?? [];
  const exceptionTotal = exceptionSummary?.total ?? 0;
  const initialExceptionsError = exceptions.isError && exceptions.data === undefined;

  useEffect(() => {
    if (attentionFilter === "all" && exceptionSummary) {
      setAllProblemsCount(exceptionSummary.total);
    }
  }, [attentionFilter, exceptionSummary]);

  function projectHref(row: (typeof attentionProjects)[number]) {
    if (attentionFilter === "actions" && row.reasons.openActions) {
      return `/projects/${row.projectId}?tab=tickets` as Route;
    }
    if (
      (attentionFilter === "behind" && row.reasons.behind) ||
      (attentionFilter === "reporting" &&
        (row.reasons.unreported || row.reasons.stale || row.reasons.reportsDue)) ||
      (attentionFilter === "review" && row.reasons.awaitingReview)
    ) {
      return `/projects/${row.projectId}?tab=progress` as Route;
    }
    if (row.reasons.baselineMissing) return `/projects/${row.projectId}?tab=baseline` as Route;
    if (
      row.reasons.behind ||
      row.reasons.unreported ||
      row.reasons.stale ||
      row.reasons.reportsDue ||
      row.reasons.awaitingReview
    ) {
      return `/projects/${row.projectId}?tab=progress` as Route;
    }
    return `/projects/${row.projectId}?tab=tickets` as Route;
  }

  function problemReasons(row: (typeof attentionProjects)[number]) {
    return (
      <span className="mt-1.5 flex flex-wrap gap-1">
        {row.reasons.behind && <Badge variant="destructive">{t.exceptions.behind}</Badge>}
        {row.reasons.baselineMissing && <Badge variant="secondary">{t.exceptions.baselineMissing}</Badge>}
        {row.reasons.unreported && <Badge variant="outline">{t.exceptions.unreported}</Badge>}
        {row.reasons.stale && (
          <Badge variant="outline" className="border-warning text-warning">
            {t.exceptions.stale}
          </Badge>
        )}
        {row.reasons.reportsDue && (
          <Badge variant="outline" className="border-warning">
            {t.exceptions.reportsDue}: {row.reportsDue}
          </Badge>
        )}
        {row.reasons.awaitingReview && (
          <Badge variant="secondary">
            {t.exceptions.awaitingReview}: {row.reportsAwaitingReview}
          </Badge>
        )}
        {row.reasons.openActions && (
          <Badge variant="outline">
            {t.exceptions.openIssues}: {row.openTickets}
          </Badge>
        )}
      </span>
    );
  }

  function projectChange(row: (typeof attentionProjects)[number]) {
    if (row.deviation === null || row.previousDeviation === null) return null;
    return row.deviation - row.previousDeviation;
  }

  function changeLabel(value: number | null) {
    if (value === null) return "—";
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${sign}${quantity(Math.abs(value))}%`;
  }

  return (
    <div className="space-y-5">
      <p role="status" className="sr-only">
        {dashboardPending
          ? t.dashboard.loading
          : dashboardHasError
            ? t.common.loadFailed
            : t.dashboard.loaded}
      </p>
      <div>
        <Card
          id="needs-attention"
          aria-busy={exceptions.isPending || exceptions.isFetchingNextPage}
          className="scroll-mt-4 overflow-hidden"
        >
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>{t.exceptions.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{t.exceptions.description}</p>
              </div>
              <Link
                href="/projects"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t.projects.allProjects}
                <ChevronRight />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {exceptions.isPending && <Skeleton className="mx-5 my-5 h-72 w-[calc(100%-2.5rem)]" />}
            {exceptions.isError && !exceptions.data && (
              <QueryError
                error={exceptions.error}
                onRetry={() => void exceptions.refetch()}
                className="m-5"
              />
            )}
            {exceptions.data && (
              <div className="grid gap-2 border-b p-4 sm:grid-cols-2 xl:grid-cols-5">
                {(
                  [
                    [
                      "all",
                      t.exceptions.allProblems,
                      attentionFilter === "all" ? exceptionTotal : allProblemsCount,
                    ],
                    ["behind", t.exceptions.behind, exceptionSummary?.counts.behind ?? 0],
                    [
                      "reporting",
                      t.exceptions.reportingProblems,
                      exceptionSummary?.counts.reporting ?? 0,
                    ],
                    [
                      "review",
                      t.exceptions.awaitingReview,
                      exceptionSummary?.counts.awaitingReview ?? 0,
                    ],
                    [
                      "actions",
                      t.exceptions.openIssues,
                      exceptionSummary?.counts.openTickets ?? 0,
                    ],
                  ] as const
                )
                  .filter(([key]) => key !== "review" || canReview)
                  .map(([key, label, count]) => (
                    <Button
                      key={key}
                      variant={attentionFilter === key ? "secondary" : "outline"}
                      className={cn(
                        "h-auto justify-between gap-3 py-3",
                        key === "behind" && count > 0 && "border-destructive/40",
                        attentionFilter === key && key === "behind" && "bg-destructive/10 text-destructive",
                      )}
                      aria-pressed={attentionFilter === key}
                      onClick={() => setAttentionFilter(key)}
                    >
                      <span className="text-start">{label}</span>
                      <span className="text-lg font-semibold tabular-nums">{count}</span>
                    </Button>
                  ))}
              </div>
            )}
            {exceptions.data && exceptionTotal === 0 && attentionFilter === "all" && (
              <div className="px-6 py-14 text-center">
                <p className="font-medium">{t.exceptions.empty}</p>
              </div>
            )}
            {exceptions.data && exceptionTotal === 0 && attentionFilter !== "all" && (
              <div className="px-6 py-14 text-center">
                <p className="font-medium">{t.exceptions.filterEmpty}</p>
                <Button variant="link" onClick={() => setAttentionFilter("all")}>{t.exceptions.showAll}</Button>
              </div>
            )}
            {exceptions.data && attentionProjects.length > 0 && (
              <div>
                <div className="hidden grid-cols-[minmax(12rem,1.5fr)_minmax(9rem,1fr)_7rem_7rem_8rem_5rem] gap-4 border-b px-5 py-3 text-xs font-medium text-muted-foreground xl:grid">
                  <span>{t.exceptions.project}</span>
                  <span>{t.exceptions.planned} / {t.exceptions.actual}</span>
                  <span>{t.exceptions.variance}</span>
                  <span>{t.exceptions.change}</span>
                  <span>{t.exceptions.dataDate}</span>
                  <span className="text-right">{t.exceptions.issues}</span>
                </div>
                <div className="divide-y">
                  {attentionProjects.map((row) => {
                    const change = projectChange(row);
                    return (
                      <article
                        key={row.projectId}
                        className={cn(
                          "grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 xl:grid-cols-[minmax(12rem,1.5fr)_minmax(9rem,1fr)_7rem_7rem_8rem_5rem] xl:px-5",
                          row.reasons.behind && "bg-destructive/[0.035]",
                        )}
                      >
                        <div className="col-span-2 min-w-0 xl:col-span-1">
                          <Link
                            href={projectHref(row)}
                            className="block min-w-0 rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block truncate" title={row.name}>{row.name}</span>
                            <span className="font-mono text-xs font-normal text-muted-foreground">{row.code}</span>
                          </Link>
                          {problemReasons(row)}
                        </div>

                        <div className="col-span-2 min-w-0 xl:col-span-1">
                          <span className="mb-1 block text-xs text-muted-foreground xl:hidden">
                            {t.exceptions.planned} / {t.exceptions.actual}
                          </span>
                          {!row.hasBaseline ? (
                            <div>
                              <Link href={`/projects/${row.projectId}?tab=baseline`} className="text-sm font-medium text-muted-foreground hover:underline">
                                {t.exceptions.baselineMissing}
                              </Link>
                              <span className="block text-xs text-muted-foreground">
                                {interpolate(t.exceptions.manualProgress, { value: percent(row.progress) })}
                              </span>
                            </div>
                          ) : row.dataDate === null ? (
                            <span className="text-sm text-muted-foreground">{t.exceptions.noReadings}</span>
                          ) : (
                            <>
                              <div className="flex items-center justify-between gap-3 text-xs tabular-nums">
                                <span className="text-muted-foreground">{percent(row.planned)}</span>
                                <span className="font-medium">{percent(row.progress)}</span>
                              </div>
                              <Meter
                                value={row.progress}
                                max={100}
                                segments={8}
                                ariaLabel={interpolate(t.dashboard.projectProgressMeter, { project: row.name })}
                                className="mt-1.5"
                              />
                            </>
                          )}
                        </div>

                        <div>
                          <span className="mb-1 block text-xs text-muted-foreground xl:hidden">{t.exceptions.variance}</span>
                          <DeviationBadge value={row.deviation} />
                        </div>
                        <div>
                          <span className="mb-1 block text-xs text-muted-foreground xl:hidden">{t.exceptions.change}</span>
                          <span
                            className={cn(
                              "font-medium tabular-nums",
                              change !== null && change < 0 && "text-destructive",
                              change !== null && change > 0 && "text-success",
                            )}
                          >
                            {changeLabel(change)}
                          </span>
                          <span className="block text-xs text-muted-foreground">{t.exceptions.sinceLast}</span>
                        </div>
                        <div>
                          <span className="mb-1 block text-xs text-muted-foreground xl:hidden">{t.exceptions.dataDate}</span>
                          <span className="whitespace-nowrap text-sm">{formatDate(row.dataDate)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.reportAgeDays === null
                              ? t.exceptions.noReadings
                              : plural(t.exceptions.daysAgo, row.reportAgeDays)}
                          </span>
                        </div>
                        <div className="xl:text-right">
                          <span className="mb-1 block text-xs text-muted-foreground xl:hidden">{t.exceptions.issues}</span>
                          <Link
                            href={`/projects/${row.projectId}?tab=tickets`}
                            aria-label={`${t.exceptions.openIssues}: ${row.name}, ${row.openTickets}`}
                            className="inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 font-medium tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row.openTickets}
                          </Link>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {!initialExceptionsError && (
              <div className="px-5">
                <InfiniteLoadMore
                  hasNextPage={exceptions.hasNextPage}
                  isFetchingNextPage={exceptions.isFetchingNextPage}
                  isFetchNextPageError={exceptions.isFetchNextPageError}
                  loadedCount={attentionProjects.length}
                  total={exceptionTotal}
                  onLoadMore={() => void exceptions.fetchNextPage()}
                />
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Card aria-busy={summary.isPending}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Wallet className="size-4" />{t.dashboard.portfolioControl}</CardTitle>
            <p className="text-sm text-muted-foreground">{t.dashboard.portfolioControlDescription}</p>
          </CardHeader>
          <CardContent>
            {summary.isPending && <Skeleton className="h-28 w-full" />}
            {summary.isError && !summary.data && <QueryError error={summary.error} onRetry={() => void summary.refetch()} />}
            {summary.data && (
              <div className="grid gap-5 sm:grid-cols-2 sm:divide-x">
                <div className="space-y-1 sm:pr-5">
                  <p className="text-xs text-muted-foreground">{t.dashboard.portfolioValue}</p>
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">{moneyCompact(summary.data.portfolioValue)}</p>
                  <p className="text-xs text-muted-foreground">
                    {plural(t.dashboard.baselineCoverage, summary.data.projects.total, {
                      baselined: summary.data.projects.baselined,
                    })}
                  </p>
                </div>
                <div className="space-y-2 sm:pl-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">{t.dashboard.workCompleted}</p>
                      <p className="text-2xl font-semibold tracking-tight tabular-nums">{summary.data.workCompletedValue === null ? "—" : moneyCompact(summary.data.workCompletedValue)}</p>
                    </div>
                    <span className="font-medium tabular-nums">{percent(summary.data.valueCompletionPercent)}</span>
                  </div>
                  <Meter
                    value={summary.data.valueCompletionPercent ?? 0}
                    max={100}
                    segments={12}
                    ariaLabel={t.dashboard.portfolioProgressMeter}
                  />
                  <p className="text-xs text-muted-foreground">
                    {summary.data.workCompletedValue === null
                      ? t.dashboard.noMeasuredWork
                      : `${money(summary.data.workCompletedValue)} · ${plural(t.dashboard.measuredCoverage, summary.data.projects.measured)}`}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card aria-busy={summary.isPending}>
          <CardHeader>
            <CardTitle>{t.dashboard.statusSnapshot}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {summary.isPending && <Skeleton className="h-32 w-full" />}
            {summary.isError && !summary.data && <p className="py-5 text-sm text-muted-foreground">{t.common.loadFailed}</p>}
            {summary.data && PROJECT_STATUSES.map((status) => (
              <Link key={status} href={`/projects?status=${status}`} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatusBadge kind="project" value={status} />
                <span className="font-medium tabular-nums">{summary.data.projects.byStatus[status]}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
