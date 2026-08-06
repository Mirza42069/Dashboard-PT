"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import {
  ChevronRight,
  Wallet,
} from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { DeviationBadge } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
type AttentionFilter = "all" | "behind" | "reporting" | "review" | "actions";

export default function DashboardOverview({ canReview }: { canReview: boolean }) {
  const t = useT();
  const { formatDate, money, moneyCompact, percent, quantity } = useFormat();
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>("all");
  const summary = useQuery(trpc.project.summary.queryOptions());
  const exceptions = useQuery(trpc.project.exceptions.queryOptions());
  const dashboardPending = summary.isPending || exceptions.isPending;
  const dashboardHasError = summary.isError || exceptions.isError;

  const attentionProjects = exceptions.data?.projects ?? [];
  const visibleProjects = attentionProjects.filter((row) => {
    if (attentionFilter === "behind") return row.reasons.behind;
    if (attentionFilter === "reporting") {
      return row.reasons.unreported || row.reasons.stale || row.reasons.reportsDue;
    }
    if (attentionFilter === "review") return row.reasons.awaitingReview;
    if (attentionFilter === "actions") return row.reasons.openActions;
    return true;
  });

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
        <Card id="needs-attention" aria-busy={exceptions.isPending} className="scroll-mt-4 overflow-hidden">
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>{t.exceptions.title}</CardTitle>
                <p className="text-sm text-muted-foreground">{t.exceptions.description}</p>
              </div>
              <Button
                nativeButton={false}
                variant="outline"
                size="sm"
                render={<Link href="/projects" />}
              >
                {t.projects.allProjects}
                <ChevronRight />
              </Button>
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
                    ["all", t.exceptions.allProblems, attentionProjects.length],
                    ["behind", t.exceptions.behind, exceptions.data.counts.behind],
                    ["reporting", t.exceptions.reportingProblems, exceptions.data.counts.reporting],
                    ["review", t.exceptions.awaitingReview, exceptions.data.counts.awaitingReview],
                    ["actions", t.exceptions.openIssues, exceptions.data.counts.openTickets],
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
            {exceptions.data && attentionProjects.length === 0 && (
              <div className="px-6 py-14 text-center">
                <p className="font-medium">{t.exceptions.empty}</p>
              </div>
            )}
            {exceptions.data && attentionProjects.length > 0 && visibleProjects.length === 0 && (
              <div className="px-6 py-14 text-center">
                <p className="font-medium">{t.exceptions.filterEmpty}</p>
                <Button variant="link" onClick={() => setAttentionFilter("all")}>{t.exceptions.showAll}</Button>
              </div>
            )}
            {exceptions.data && visibleProjects.length > 0 && (
              <>
                <div className="hidden md:block">
                  <Table className="min-w-[760px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-5">{t.exceptions.project}</TableHead>
                        <TableHead>{t.exceptions.planned} / {t.exceptions.actual}</TableHead>
                        <TableHead>{t.exceptions.variance}</TableHead>
                        <TableHead>{t.exceptions.change}</TableHead>
                        <TableHead>{t.exceptions.dataDate}</TableHead>
                        <TableHead className="pr-5 text-right">{t.exceptions.issues}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visibleProjects.map((row) => {
                        const change = projectChange(row);
                        return (
                          <TableRow key={row.projectId} className={cn(row.reasons.behind && "bg-destructive/[0.035]")}>
                            <TableCell className="max-w-56 pl-5">
                              <Link
                                href={projectHref(row)}
                                className="block min-w-0 rounded-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <span className="block truncate" title={row.name}>{row.name}</span>
                                <span className="font-mono text-xs font-normal text-muted-foreground">{row.code}</span>
                              </Link>
                              {problemReasons(row)}
                            </TableCell>
                            <TableCell className="min-w-36">
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
                            </TableCell>
                            <TableCell><DeviationBadge value={row.deviation} /></TableCell>
                            <TableCell>
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
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <span className="text-sm">{formatDate(row.dataDate)}</span>
                              <span className="block text-xs text-muted-foreground">
                                {row.reportAgeDays === null
                                  ? t.exceptions.noReadings
                                  : plural(t.exceptions.daysAgo, row.reportAgeDays)}
                              </span>
                              {(row.reportsDue > 0 || row.reportsAwaitingReview > 0) && (
                                <span className="mt-1.5 flex flex-wrap gap-1">
                                  {row.reportsDue > 0 && (
                                    <Badge variant="outline">{t.exceptions.reportsDue}: {row.reportsDue}</Badge>
                                  )}
                                  {canReview && row.reportsAwaitingReview > 0 && (
                                    <Badge variant="secondary">{t.exceptions.awaitingReview}: {row.reportsAwaitingReview}</Badge>
                                  )}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <Link
                                href={`/projects/${row.projectId}?tab=tickets`}
                                aria-label={`${t.exceptions.openIssues}: ${row.name}, ${row.openTickets}`}
                                className="inline-flex min-w-8 items-center justify-center rounded-md border px-2 py-1 font-medium tabular-nums hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {row.openTickets}
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="divide-y md:hidden">
                  {visibleProjects.map((row) => {
                    const change = projectChange(row);
                    return (
                      <article key={row.projectId} className={cn("space-y-3 px-4 py-4", row.reasons.behind && "bg-destructive/[0.035]")}>
                        <div className="flex items-start justify-between gap-3">
                          <Link
                            href={projectHref(row)}
                            className="min-w-0 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="block truncate font-medium" title={row.name}>{row.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                          </Link>
                          <DeviationBadge value={row.deviation} className="shrink-0" />
                        </div>
                        {!row.hasBaseline ? (
                          <div>
                            <Link href={`/projects/${row.projectId}?tab=baseline`} className="text-sm font-medium text-muted-foreground hover:underline">
                              {t.exceptions.baselineMissing}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {interpolate(t.exceptions.manualProgress, { value: percent(row.progress) })}
                            </p>
                          </div>
                        ) : row.dataDate === null ? (
                          <p className="text-sm text-muted-foreground">{t.exceptions.noReadings}</p>
                        ) : (
                          <div>
                            <div className="mb-1.5 flex justify-between text-xs tabular-nums">
                              <span className="text-muted-foreground">{t.exceptions.planned} {percent(row.planned)}</span>
                              <span className="font-medium">{t.exceptions.actual} {percent(row.progress)}</span>
                            </div>
                            <Meter
                              value={row.progress}
                              max={100}
                              segments={8}
                              ariaLabel={interpolate(t.dashboard.projectProgressMeter, { project: row.name })}
                            />
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-2 text-xs">
                          <div>
                            <span className="block text-muted-foreground">{t.exceptions.change}</span>
                            <span className={cn("font-medium tabular-nums", change !== null && change < 0 && "text-destructive", change !== null && change > 0 && "text-success")}>{changeLabel(change)}</span>
                          </div>
                          <div>
                            <span className="block text-muted-foreground">{t.exceptions.dataDate}</span>
                            <span className="font-medium">{formatDate(row.dataDate)}</span>
                          </div>
                          <div>
                            <span className="block text-muted-foreground">{t.exceptions.issues}</span>
                            <Link
                              href={`/projects/${row.projectId}?tab=tickets`}
                              aria-label={`${t.exceptions.openIssues}: ${row.name}, ${row.openTickets}`}
                              className="font-medium tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {row.openTickets}
                            </Link>
                          </div>
                        </div>
                        {problemReasons(row)}
                      </article>
                    );
                  })}
                </div>
              </>
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
