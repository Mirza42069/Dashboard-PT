"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import {
  ChevronRight,
  Inbox,
  SearchX,
} from "@DashboardV2/ui/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@DashboardV2/ui/components/popover";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@DashboardV2/ui/components/tooltip";
import { cn } from "@DashboardV2/ui/lib/utils";
import type { Route } from "next";
import Link from "next/link";
import type { ProjectModuleKey } from "@DashboardV2/api/lib/project-modules";

import { DeviationBadge, formatDeviation } from "@/components/deviation-badge";
import { Hint } from "@/components/hint";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { QueryError } from "@/components/query-error";
import { TickBar } from "@/components/tick-bar";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import {
  isProjectTabVisible,
  projectTabPath,
  type ProjectTab,
} from "@/lib/project-navigation";
import { useCoarsePointer } from "@/lib/use-coarse-pointer";
import { useFormat } from "@/lib/use-format";

import {
  levelFor,
  signalsFor,
  type SeverityInput,
  type SeverityLevel,
  type Signal,
  type SignalId,
} from "./severity";

export type AttentionFilter = "all" | "behind" | "reporting" | "review" | "actions";

/** The row shape this band needs — all of it already on project.exceptions. */
export type AttentionRow = SeverityInput & {
  projectId: string;
  code: string;
  name: string;
  progress: number;
  /** Planned percent at the data date. Already on the payload; the marks quote
   *  it beside `progress`, because "behind" only means something next to the
   *  number it is behind. */
  planned: number;
  hasBaseline: boolean;
  dataDate: string | null;
  reportAgeDays: number | null;
  hiddenModules: ProjectModuleKey[];
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
  settled: "text-[var(--chart-1)]",
};

/**
 * Every column's width *and* the breakpoint it survives to, defined once.
 *
 * This list used to print a caption above each figure on each row — four
 * repeated words per project, twenty-five projects deep — and the reason given
 * for having no header instead was that the columns drop out at `sm` and `xl`,
 * so a header would keep promising columns that are not there.
 *
 * That is only true of a header that states its own widths. Sharing this record
 * between the header strip and the cells means the header loses exactly the
 * columns the rows lose, at exactly the same width, and cannot be edited out of
 * alignment later without editing both at once.
 *
 * The signals are deliberately not here: they have no fixed width (a row
 * carries one to seven of them) and need none — the project name takes all the
 * slack, so the marks are already flush against the first fixed column. There
 * is nothing to align a label to, and glyphs that each carry their own
 * explanation do not want one.
 */
const COL = {
  // 20 ticks at 8px with 2px gaps is 198px, plus the percent beside it.
  progress: "hidden w-64 shrink-0 xl:block",
  deviation: "w-24 shrink-0 text-right sm:w-32",
  dataDate: "hidden w-24 shrink-0 text-right xl:block",
};

/** The padding and gaps a row and the header strip must share to line up. */
const GUTTER = "gap-2 pl-4 pr-3 sm:gap-3 sm:pl-5 sm:pr-4";

export function AttentionList({
  rows,
  total,
  filter,
  onFilterChange,
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
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  onLoadMore: () => void;
}) {
  const t = useT();
  const { formatDate, percent } = useFormat();
  const coarse = useCoarsePointer();

  /**
   * The name behind each signal icon. The tooltip's first line, the popup's
   * heading, and the mark's accessible name.
   */
  const SIGNAL_LABEL: Record<SignalId, string> = {
    behind: t.exceptions.behind,
    reportsDue: t.exceptions.reportsDue,
    stale: t.exceptions.stale,
    unreported: t.exceptions.unreported,
    awaitingReview: t.exceptions.awaitingReview,
    baselineMissing: t.exceptions.baselineMissing,
    openActions: t.exceptions.openIssues,
  };

  /**
   * What is wrong, in this project's own figures.
   *
   * Everything here is already on the row — the marks add no query. A signal
   * whose numbers are missing falls back to the generic hint rather than
   * printing "null%": a project can be flagged behind and still have a null
   * deviation if its baseline went away between the count and the read.
   */
  function signalDetail(id: SignalId, row: AttentionRow): string {
    switch (id) {
      case "behind":
        return row.deviation === null
          ? t.exceptions.behind
          : interpolate(t.exceptions.behindDetail, {
              actual: percent(row.progress),
              planned: percent(row.planned),
              deviation: formatDeviation(row.deviation),
            });
      case "reportsDue":
        return plural(t.exceptions.reportsDueDetail, row.reportsDue);
      case "stale":
        return row.dataDate === null || row.reportAgeDays === null
          ? t.exceptions.staleHint
          : interpolate(t.exceptions.staleDetail, {
              age: plural(t.exceptions.daysAgo, row.reportAgeDays),
              date: formatDate(row.dataDate),
            });
      case "unreported":
        return t.exceptions.unreportedDetail;
      case "awaitingReview":
        return plural(t.exceptions.awaitingReviewDetail, row.reportsAwaitingReview);
      case "baselineMissing":
        return t.exceptions.baselineMissingDetail;
      case "openActions":
        return plural(t.exceptions.openActionsDetail, row.openTickets);
    }
  }

  /**
   * Where a signal's mark sends you.
   *
   * Not the same as `href` below, which answers "where does this *row* go" and
   * has to pick one tab for a project carrying several problems. A mark is
   * already about one signal, so it can send you straight to the tab that fixes
   * that one.
   */
  function signalHref(id: SignalId, row: AttentionRow): Route {
    if (id === "baselineMissing") {
      return projectTabPath(row.projectId, "baseline", row.hiddenModules, "boq") as Route;
    }
    const tab = id === "openActions" ? "tickets" : "progress";
    return projectTabPath(row.projectId, tab, row.hiddenModules) as Route;
  }

  /**
   * Where the project name goes.
   *
   * Which tab matters depends on why the row is here, and on the filter the
   * reader is looking through — someone filtering by actions wants the actions
   * tab even on a project that is also behind.
   */
  function href(row: AttentionRow): Route {
    if (filter === "actions" && row.reasons.openActions) {
      return projectTabPath(row.projectId, "tickets", row.hiddenModules) as Route;
    }
    const candidates: ProjectTab[] = [];
    if (row.reasons.baselineMissing) candidates.push("baseline");
    if (
      row.reasons.behind ||
      row.reasons.unreported ||
      row.reasons.stale ||
      row.reasons.reportsDue ||
      row.reasons.awaitingReview
    ) {
      candidates.push("progress");
    }
    candidates.push("tickets");
    const tab = candidates.find((candidate) =>
      isProjectTabVisible(candidate, row.hiddenModules, false),
    );
    return projectTabPath(
      row.projectId,
      tab ?? "overview",
      row.hiddenModules,
      "boq",
    ) as Route;
  }

  /**
   * One signal, as a mark you can read and press.
   *
   * Two shapes of the same control, because one shape cannot serve both
   * pointers. With a mouse the mark is a link: hovering says what is wrong,
   * clicking goes to the tab that fixes it — one gesture each, where this used
   * to cost two clicks through a popup whose whole content was that sentence
   * and that same link. Under a finger there is no hover to spend on the
   * explanation, and Base UI disables tooltips on touch outright, so there the
   * tap still opens the popup and the popup still carries the link.
   *
   * A function returning markup rather than a component: it closes over `t` and
   * the formatters, and a component declared in a render body remounts its
   * subtree every time the parent renders.
   */
  function signalMark(row: AttentionRow, { id, Icon, level: tone, count }: Signal) {
    const name = SIGNAL_LABEL[id];
    const detail = signalDetail(id, row);
    const glyph = (
      <>
        <Icon className="size-3.5" />
        {count !== undefined && <span className="text-xs tabular-nums">{count}</span>}
      </>
    );
    const markClass = cn(
      "inline-flex items-center gap-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      coarse && "min-h-11 min-w-11 justify-center",
      SIGNAL_TONE[tone],
    );

    if (coarse) {
      return (
        <Popover key={id}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={markClass}
                aria-label={count === undefined ? name : `${name}: ${count}`}
              />
            }
          >
            {glyph}
          </PopoverTrigger>
          <PopoverContent className="w-72 max-w-[min(18rem,calc(100vw-2rem))] space-y-1.5 px-3 py-2.5">
            <p className={cn("text-xs font-medium", SIGNAL_TONE[tone])}>{name}</p>
            <p className="text-xs text-muted-foreground">{detail}</p>
            <Link
              href={signalHref(id, row)}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {interpolate(t.exceptions.viewProject, { name: row.name })}
              <ChevronRight className="size-3.5 text-foreground" />
            </Link>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Tooltip key={id}>
        <TooltipTrigger
          render={
            <Link
              href={signalHref(id, row)}
              className={markClass}
              // A tooltip is not reachable by a screen reader, so what it says
              // is the link's own name rather than a description of it — the
              // same rule Hint follows.
              aria-label={`${name}. ${detail}`}
            />
          }
        >
          {glyph}
        </TooltipTrigger>
        <TooltipContent className="max-w-xs flex-col items-start gap-0.5 text-left">
          <span className="font-medium">{name}</span>
          <span className="text-background/75">{detail}</span>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    // pt-0 because there is no header to pad away from: Card's own top padding
    // would leave a bare strip of card above the column names, which reads as a
    // header that failed to render rather than as one that was never there. The
    // sr-only heading is absolutely positioned, so it is not a flex item and
    // adds no gap of its own.
    <Card
      id="needs-attention"
      aria-busy={pending}
      className="scroll-mt-4 overflow-hidden pt-0"
    >
      {/* The heading is gone from the page, not from the accessibility tree.
          The portfolio figures it used to sit beside are a card in the row
          above now, and the "All projects" button is that card's arrow — what
          was left was a title over a list whose first row already says what it
          is. A list of projects with no name at all is still a regression, so
          the words stay for a reader who cannot see the rows. */}
      <h2 className="sr-only">{t.exceptions.title}</h2>

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
                  <EmptyMedia variant="icon">
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
              <>
                {/* The headline: every figure named once, at the top, rather
                    than once per project.

                    Not aria-hidden. It holds the deviation rule's Hint, which
                    is a focusable control and must not be buried, so it stays
                    an ordinary header line — and the cells below carry their
                    own sr-only names anyway, for a reader who arrives at a row
                    without having heard this one. */}
                <div className={cn("flex items-center border-b bg-muted/30 py-1.5", GUTTER)}>
                  <ColumnLabel className="min-w-0 flex-1">{t.projects.project}</ColumnLabel>
                  <ColumnLabel className={COL.progress}>{t.projects.progressMeter}</ColumnLabel>
                  <span className={cn(COL.deviation, "inline-flex items-center justify-end gap-1")}>
                    <ColumnLabel>{t.exceptions.deviationColumn}</ColumnLabel>
                    <Hint text={t.exceptions.deviationColumnHint} />
                  </span>
                  <ColumnLabel className={COL.dataDate}>{t.exceptions.dataDate}</ColumnLabel>
                </div>

                <ul className="divide-y">
                  {rows.map((row) => {
                    const level = levelFor(row);
                    const signals = signalsFor(row);

                    return (
                      <li key={row.projectId} className="relative">
                        {/* The whole at-a-glance read: one edge, one colour. */}
                        <span
                          className={cn("absolute inset-y-0 left-0 w-0.5", EDGE[level])}
                          aria-hidden
                        />
                        <div className={cn("flex items-center py-1.5", GUTTER)}>
                          {/* One line, not two. The code is a short tag rather
                              than a second title, and giving it its own line
                              cost every project in the list half its height to
                              say otherwise. */}
                          <Link
                            href={href(row)}
                            className="flex min-w-0 flex-1 items-baseline gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            aria-label={interpolate(t.exceptions.viewProject, { name: row.name })}
                          >
                            <span className="truncate text-sm font-medium">{row.name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {row.code}
                            </span>
                          </Link>

                          {/* Seven words became seven icons; the words are in
                              the marks. */}
                          <span className="flex shrink-0 items-center gap-1.5">
                            {signals.map((signal) => signalMark(row, signal))}
                          </span>

                          {/* The same bar as the cards and the header. A
                              six-segment meter here and a fine tick bar
                              everywhere else read as two kinds of measurement,
                              and they are the same kind. */}
                          <span className={COL.progress}>
                            {row.hasBaseline && row.dataDate !== null ? (
                              <span
                                className="flex items-center gap-2"
                                aria-label={interpolate(t.dashboard.projectProgressMeter, {
                                  project: row.name,
                                })}
                                role="meter"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={row.progress}
                                aria-valuetext={percent(row.progress)}
                              >
                                {/* Behind schedule is not on the bar. It used
                                    to override the fill to red, which stopped
                                    working the moment red also meant "barely
                                    started" — and the deviation column right
                                    beside this one says it in a number, which
                                    a colour never could. */}
                                <TickBar value={row.progress} max={100} />
                                <span
                                  className="text-xs text-muted-foreground tabular-nums"
                                  aria-hidden
                                >
                                  {percent(row.progress)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {row.hasBaseline ? t.exceptions.noReadings : ""}
                              </span>
                            )}
                          </span>

                          <span className={cn(COL.deviation, "text-sm whitespace-nowrap")}>
                            <span className="sr-only">{t.periodSummary.deviationCumulative}: </span>
                            <DeviationBadge value={row.deviation} compact behindOnly />
                          </span>

                          <span className={cn(COL.dataDate, "text-xs text-muted-foreground")}>
                            <span className="sr-only">{t.exceptions.dataDate}: </span>
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
              </>
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

/**
 * A column's name, in the headline.
 *
 * Small, muted and uppercase so it reads as a caption rather than as another
 * value competing with the figures under it. It takes the column's own class
 * out of `COL`, which is what makes it disappear at exactly the breakpoint
 * those figures do.
 */
function ColumnLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "text-[10px] leading-tight font-medium uppercase tracking-wide text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
