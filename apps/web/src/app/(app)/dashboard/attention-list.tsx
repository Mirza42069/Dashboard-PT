"use client";

import { Button, buttonVariants } from "@DashboardV2/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import { ChevronRight, Inbox, SearchX } from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";

import { DeviationBadge } from "@/components/deviation-badge";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { QueryError } from "@/components/query-error";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

import { TickBar } from "./tick-bar";

import { levelFor, signalsFor, type SeverityInput, type SeverityLevel, type SignalId } from "./severity";

export type AttentionFilter = "all" | "behind" | "reporting" | "review" | "actions";

/** The row shape this band needs — all of it already on project.exceptions. */
export type AttentionRow = SeverityInput & {
  projectId: string;
  code: string;
  name: string;
  progress: number;
  hasBaseline: boolean;
  dataDate: string | null;
  reportAgeDays: number | null;
};

/** The left edge, and nothing else, carries the row's urgency. */
const EDGE: Record<SeverityLevel, string> = {
  late: "bg-destructive",
  waiting: "bg-brand",
  settled: "bg-transparent",
};

const SIGNAL_TONE: Record<SeverityLevel, string> = {
  late: "text-destructive",
  waiting: "text-brand",
  // A colour, not the grey of the text it sits next to.
  settled: "text-[var(--chart-3)]",
};

export function AttentionList({
  rows,
  total,
  filter,
  onFilterChange,
  portfolioValue,
  completionPercent,
  summaryPending,
  pending,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  isFetchNextPageError,
  onLoadMore,
}: {
  rows: AttentionRow[];
  total: number;
  filter: AttentionFilter;
  /** Only used to clear the filter from the empty state. */
  onFilterChange: (filter: AttentionFilter) => void;
  portfolioValue: number | undefined;
  completionPercent: number | null | undefined;
  summaryPending: boolean;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
}) {
  const t = useT();
  const { formatDate, moneyCompact, percent, quantity } = useFormat();

  /** The name behind each signal icon. Shown on hover, never on the row. */
  const SIGNAL_LABEL: Record<SignalId, string> = {
    behind: t.exceptions.behind,
    reportsDue: t.exceptions.reportsDueHint,
    stale: t.exceptions.staleHint,
    unreported: t.exceptions.unreported,
    awaitingReview: t.exceptions.awaitingReviewHint,
    baselineMissing: t.exceptions.baselineMissing,
    openActions: t.exceptions.openIssues,
  };

  /**
   * Where the project name goes.
   *
   * Which tab matters depends on why the row is here, and on the filter the
   * reader is looking through — someone filtering by actions wants the actions
   * tab even on a project that is also behind.
   */
  function href(row: AttentionRow): Route {
    const base = `/projects/${row.projectId}`;
    if (filter === "actions" && row.reasons.openActions) return `${base}?tab=tickets` as Route;
    if (row.reasons.baselineMissing) return `${base}?tab=boq` as Route;
    if (
      row.reasons.behind ||
      row.reasons.unreported ||
      row.reasons.stale ||
      row.reasons.reportsDue ||
      row.reasons.awaitingReview
    ) {
      return `${base}?tab=progress` as Route;
    }
    return `${base}?tab=tickets` as Route;
  }

  function change(row: AttentionRow) {
    if (row.deviation === null || row.previousDeviation === null) return null;
    return row.deviation - row.previousDeviation;
  }

  return (
    <Card id="needs-attention" aria-busy={pending} className="scroll-mt-4 overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <CardTitle>{t.exceptions.title}</CardTitle>

          {/* The portfolio figures live here now. They are context for the list
              rather than something to act on, so they sit beside its title
              instead of taking two of the four cards above. */}
          {/* w-full on a phone so it takes its own line: inline beside the
              title there is not room for the figures and the bar, and a
              shrink-0 span was running off the card rather than truncating. */}
          <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:flex-1 sm:flex-nowrap">
            {summaryPending ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <>
                <span className="truncate text-sm text-muted-foreground tabular-nums">
                  {portfolioValue === undefined ? "—" : moneyCompact(portfolioValue)}
                  {completionPercent !== null && completionPercent !== undefined && (
                    <> · {percent(completionPercent)} {t.dashboard.workCompleted.toLowerCase()}</>
                  )}
                </span>
                {/* Its own line on a phone, via the wrap on the row above:
                    squeezed in beside the figures it ran past the card edge.
                    No width of its own — the bar is one fixed size wherever it
                    appears, so it never reads as a differently-scaled meter. */}
                <TickBar value={completionPercent ?? 0} max={100} />
              </>
            )}
          </div>

          <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t.projects.allProjects}
            <ChevronRight className="text-[var(--chart-3)]" />
          </Link>
        </div>
      </CardHeader>

      <CardContent className="px-0">
        {pending && <Skeleton className="mx-5 my-5 h-72 w-[calc(100%-2.5rem)]" />}
        {!pending && error !== null && error !== undefined && (
          <QueryError error={error} onRetry={onRetry} className="m-5" />
        )}

        {!pending && (error === null || error === undefined) && (
          <>
            {total === 0 && (
              <Empty className="border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon" className="text-[var(--chart-3)]">
                    {filter === "all" ? <Inbox /> : <SearchX />}
                  </EmptyMedia>
                  <EmptyTitle>
                    {filter === "all" ? t.exceptions.empty : t.exceptions.filterEmpty}
                  </EmptyTitle>
                </EmptyHeader>
                {filter !== "all" && (
                  <EmptyContent>
                    <Button variant="outline" size="sm" onClick={() => onFilterChange("all")}>
                      {t.exceptions.showAll}
                    </Button>
                  </EmptyContent>
                )}
              </Empty>
            )}

            {rows.length > 0 && (
              <ul className="divide-y">
                {rows.map((row) => {
                  const level = levelFor(row);
                  const signals = signalsFor(row);
                  const delta = change(row);

                  return (
                    <li key={row.projectId} className="relative">
                      {/* The whole at-a-glance read: one edge, one colour. */}
                      <span
                        className={cn("absolute inset-y-0 left-0 w-0.5", EDGE[level])}
                        aria-hidden
                      />
                      <div className="flex items-center gap-2 py-2.5 pl-4 pr-3 sm:gap-3 sm:pl-5 sm:pr-4">
                        <Link
                          href={href(row)}
                          className="min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          aria-label={interpolate(t.exceptions.viewProject, { name: row.name })}
                        >
                          <span className="block truncate text-sm font-medium">{row.name}</span>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {row.code}
                          </span>
                        </Link>

                        {/* Seven words became seven icons; the words are in the tooltips. */}
                        <span className="flex shrink-0 items-center gap-1.5">
                          {signals.map(({ id, Icon, level: tone, count }) => {
                            const label =
                              count === undefined
                                ? SIGNAL_LABEL[id]
                                : `${SIGNAL_LABEL[id]}: ${count}`;
                            return (
                              <Tooltip key={id}>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      className={cn(
                                        "inline-flex items-center gap-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                                        SIGNAL_TONE[tone],
                                      )}
                                      aria-label={label}
                                    />
                                  }
                                >
                                  <Icon className="size-3.5" />
                                  {count !== undefined && (
                                    <span className="text-xs tabular-nums">{count}</span>
                                  )}
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">{label}</TooltipContent>
                              </Tooltip>
                            );
                          })}
                        </span>

                        {/* Under xl the row is name, signals and position — nothing
                            else. The detail is one tap away, and a phone is the
                            wrong place to reprint five column headers per project. */}
                        {/* The same bar as the cards and the header. A
                            six-segment meter here and a fine tick bar
                            everywhere else read as two kinds of measurement,
                            and they are the same kind. */}
                        <span className="hidden w-40 shrink-0 xl:block">
                          {row.hasBaseline && row.dataDate !== null ? (
                            <span
                              className="flex flex-col gap-1"
                              aria-label={`${interpolate(t.dashboard.projectProgressMeter, {
                                project: row.name,
                              })}: ${percent(row.progress)}`}
                              role="img"
                            >
                              <TickBar value={row.progress} max={100} />
                              <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
                                {percent(row.progress)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {row.hasBaseline ? t.exceptions.noReadings : ""}
                            </span>
                          )}
                        </span>

                        <span className="w-16 shrink-0 text-right sm:w-24">
                          <DeviationBadge value={row.deviation} compact />
                        </span>

                        <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums xl:block">
                          {delta === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span
                              className={cn(
                                delta < 0 && "text-destructive",
                                delta > 0 && "text-success",
                              )}
                            >
                              {delta > 0 ? "+" : delta < 0 ? "−" : ""}
                              {quantity(Math.abs(delta))}
                            </span>
                          )}
                        </span>

                        <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground xl:block">
                          {row.dataDate === null
                            ? "—"
                            : row.reportAgeDays === null
                              ? formatDate(row.dataDate)
                              : plural(t.exceptions.daysAgo, row.reportAgeDays)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="px-5">
              <InfiniteLoadMore
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                isFetchNextPageError={isFetchNextPageError}
                loadedCount={rows.length}
                total={total}
                onLoadMore={onLoadMore}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
