"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import { Input } from "@DashboardV2/ui/components/input";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Save, Trash2 } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { DeviationBadge, formatDeviation } from "@/components/deviation-badge";
import {
  MatrixRowSpacer,
  useMatrixWindow,
  WindowedMonthBandRow,
} from "@/components/matrix-window";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { Hint } from "@/components/hint";
import { QueryError } from "@/components/query-error";
import { statusLabel } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import {
  buildPeriodSummary,
  computeActualCurve,
  computePlannedCurve,
  delayContributors,
  distributionMap,
  latestPosition,
  scheduleRows,
} from "@/lib/boq/curves";
import { isEditable } from "@DashboardV2/api/lib/progress-workflow";
import { isBehindDeviation } from "@DashboardV2/api/lib/deviation";
import {
  COMPACT_CELL_WIDTH,
  MAX_PERIOD_WIDTH,
  MIN_PERIOD_WIDTH_EDITABLE,
  MIN_PERIOD_WIDTH_READONLY,
  fitMatrix,
} from "@/lib/matrix-fit";
import { toggleFold, type MonthFoldState } from "@/lib/month-fold";
import { buildMatrixColumns, buildPeriodHeader, lastPeriodOf } from "@/lib/period-header";
import { useFormat } from "@/lib/use-format";
import { useMatrixKeyboard } from "@/lib/use-matrix-keyboard";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

import DelayContributors from "./delay-contributors";
import { decimalOnly } from "./matrix-input";
import PeriodSummaryTable from "./period-summary-table";
import ReportingWorkflow from "./reporting-workflow";
import SCurveChart from "./s-curve-chart";

/** Ties the chart to the table that carries its figures for assistive tech. */
const SUMMARY_TABLE_ID = "period-summary";
/** Tracks the row padding below. The virtualiser scrolls by this. */
const ESTIMATED_ROW_HEIGHT = 60;
const ESTIMATED_HEADER_HEIGHT = 96;
/**
 * The line-name block, and every pixel of it comes out of the cells — fitMatrix
 * divides whatever is left of the container between the period columns. It was
 * 320px; the 48px trimmed off goes straight to the columns, and helps lift them
 * over COMPACT_CELL_WIDTH, which is what gates the roomier padding and text.
 * The column truncates and carries its full text on `title`, so nothing is hidden.
 */
const LEADING_WIDTH = 272;
/** The checkbox column, carved out of the leading block rather than added to it. */
const SELECT_WIDTH = 40;

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

export default function ProgressTab({
  projectId,
  canEdit,
  canReview,
  canLock,
}: {
  projectId: string;
  canEdit: boolean;
  /** Mark reviewed, approve, or return a submitted report. */
  canReview: boolean;
  /** Lock an approved period, or reopen one for correction. */
  canLock: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const { formatDate } = format;
  const queryClient = useQueryClient();

  /**
   * Edits are batched rather than saved per cell. Entering a period's readings
   * means touching many lines at once, and one "Save" is both fewer round trips
   * and a clearer undo point than a dozen silent writes.
   */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  /** Which period the workflow panel is showing. Null follows its own default. */
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [showFullMatrix, setShowFullMatrix] = useState(false);
  /**
   * What the reader has said about each month, not what is folded.
   *
   * Empty by default. Folding is now mostly the fitter's job — it narrows the
   * grid until it fits the card — and this map is the standing instruction that
   * overrules it either way. See lib/month-fold.ts for why an intent map and
   * not the set of folded months it replaced.
   */
  const [monthFold, setMonthFold] = useState<MonthFoldState>(() => new Map());

  const reportQuery = useQuery(trpc.progress.report.queryOptions({ projectId }));
  const matrixPeriods = reportQuery.data?.periods ?? [];
  const effectiveSelectedPeriodId =
    selectedPeriodId ?? matrixPeriods.find((period) => isEditable(period.status))?.id ?? "";
  // Built above the early returns because the selection hook needs it, and a
  // hook cannot be called conditionally.
  const matrixRows = scheduleRows(reportQuery.data?.items ?? []);
  /** Keyed on the BoQ line, which is what every action here addresses. */
  const selection = useRowSelection(matrixRows, {
    getId: (row) => row.leaf.id,
    resetKey: effectiveSelectedPeriodId,
  });
  // Called before the fit, because the fit needs the container width and this
  // is what measures it. Its own column *window* is off — see windowColumns —
  // so the count it is given only has to be stable, not folded.
  const matrixWindow = useMatrixWindow({
    rowCount: matrixRows.length,
    columnCount: matrixPeriods.length,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT,
    // A constant, deliberately: the fitted width changes on every resize tick,
    // and this value is in the observer effect's dependencies.
    columnWidth: MAX_PERIOD_WIDTH,
    estimatedHeaderHeight: ESTIMATED_HEADER_HEIGHT,
    leadingWidth: LEADING_WIDTH,
    stickyLeadingWidth: LEADING_WIDTH,
    windowed: !showFullMatrix,
    windowColumns: false,
  });
  const fitAnchorDate =
    matrixPeriods.find((period) => period.id === effectiveSelectedPeriodId)?.endDate ??
    reportQuery.data?.project.dataDate ??
    null;
  /**
   * Width and folding, decided together.
   *
   * "Full table" hands the fitter a width of zero, which it reads as "not
   * measured" and answers with full-width columns and no folding of its own —
   * which is exactly what that escape hatch now means.
   */
  const fit = fitMatrix({
    available: showFullMatrix ? 0 : matrixWindow.containerWidth,
    leadingWidth: LEADING_WIDTH,
    trailingWidth: 0,
    periods: matrixPeriods,
    state: monthFold,
    // Cells here are typed into, so they get the higher floor.
    minPeriodWidth: canEdit ? MIN_PERIOD_WIDTH_EDITABLE : MIN_PERIOD_WIDTH_READONLY,
    dataDate: fitAnchorDate,
  });
  const allMatrixColumns = buildMatrixColumns(matrixPeriods, fit.collapsed);
  const matrixKeyboard = useMatrixKeyboard({
    scrollRef: matrixWindow.scrollRef,
    rowCount: matrixRows.length,
    columnCount: allMatrixColumns.length,
    rowHeight: ESTIMATED_ROW_HEIGHT,
  });

  function toggleMonth(monthKey: string) {
    // What the press means depends on what is on screen, not on what is
    // stored — a month the fitter folded has nothing stored to invert.
    const rendered = fit.collapsed.has(monthKey);
    setMonthFold((current) => toggleFold(current, monthKey, rendered));
  }
  const bulkSave = useMutation(trpc.progress.bulkSave.mutationOptions());
  const markNoProgress = useMutation(trpc.progress.markNoProgress.mutationOptions());

  if (reportQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (reportQuery.isError) {
    return <QueryError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />;
  }

  const report = reportQuery.data;
  const version = report?.version ?? null;
  const items = report?.items ?? [];
  const periods = report?.periods ?? [];
  const dataDate = report?.project.dataDate ?? null;

  if (!version || version.status !== "active" || version.scheduleStatus !== "active") {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.progress.title}</EmptyTitle>
              <EmptyDescription>
                {version?.status === "active" ? t.progress.needsSchedule : t.progress.needsBaseline}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const rows = matrixRows;
  const entries = report?.entries ?? [];
  const actualSnapshots = report?.actualSnapshots ?? [];
  const cells = distributionMap(report?.distribution ?? []);
  const planned = computePlannedCurve(rows, periods, cells);
  const actual = computeActualCurve(rows, periods, entries, dataDate, actualSnapshots);
  const position = latestPosition(actual.cumulative, planned.cumulative);
  const actualSource = position.index < 0 ? null : (actual.sources[position.index] ?? null);

  // The chart and the table below it are built from this one call, so the line
  // someone is looking at and the figure they are about to quote cannot
  // disagree.
  const summary = buildPeriodSummary(rows, periods, cells, entries, dataDate, actualSnapshots);
  const visibleRows = rows.slice(matrixWindow.rowWindow.start, matrixWindow.rowWindow.end);
  // Every column, not a window of them. Columns are no longer virtualised —
  // the grid is fitted to the card instead, so there is nothing off the side to
  // leave unrendered, and a fitted grid tops out at about twenty columns, fewer
  // than the window used to draw.
  const visibleColumns = allMatrixColumns;
  // The derived set, not the reader's intent: a month the fitter folded must
  // still be offered an unfold control, and only this set knows it is folded.
  const visibleHeader = buildPeriodHeader(format, visibleColumns, dataDate, fit.collapsed);
  const renderedColumnCount = 2 + visibleColumns.length;
  /**
   * The two states a fitted grid can still be too wide in.
   *
   * "Full table" is the reader asking for the uncompressed grid and accepting
   * the scrollbar that comes with it. `overflows` is the fitter admitting it
   * could not honour both the no-scrolling promise and a month the reader
   * explicitly unfolded — and between those two, the unfold wins. Silently
   * re-folding the month someone just opened is the one outcome that would
   * make the control look broken.
   */
  const scrollsSideways = showFullMatrix || fit.overflows;
  /** Narrow enough that a column can hold a figure but not a caption under it. */
  const compact = fit.periodWidth < COMPACT_CELL_WIDTH;
  const contributors = delayContributors(rows, periods, cells, entries, dataDate);

  const chartData = periods.map((period, index) => ({
    label: String(period.periodIndex),
    planned: planned.cumulative[index] ?? 0,
    actual: actual.cumulative[index] ?? null,
  }));
  const currentPeriod = summary.find((row) => row.isCurrent);

  const entryByKey = new Map(
    entries.map((entry) => [cellKey(entry.boqItemId, entry.periodId), entry]),
  );

  /** What a cell shows: the pending edit if there is one, else the stored reading. */
  function cellValue(itemId: string, periodId: string): string {
    const key = cellKey(itemId, periodId);
    const draft = drafts.get(key);
    if (draft !== undefined) return draft;

    const entry = entryByKey.get(key);
    if (!entry) return "";

    const stored =
      entry.cumulativeQuantity !== null
        ? entry.cumulativeQuantity
        : entry.cumulativePercent !== null
          ? entry.cumulativePercent
          : null;

    return stored === null ? "" : String(stored);
  }

  /**
   * What a folded month shows: the last reading inside it.
   *
   * Walked backwards rather than reading the final period outright, because a
   * month whose last week was never reported still has a position — the one it
   * reached in the week before. Returning "—" there would say the month made no
   * progress, which is the one thing this grid must never imply.
   */
  function foldedCellValue(itemId: string, monthPeriods: { id: string }[]): string {
    for (let index = monthPeriods.length - 1; index >= 0; index--) {
      const value = cellValue(itemId, monthPeriods[index]!.id);
      if (value !== "") return value;
    }
    return "";
  }

  async function save(showSuccess = true) {
    if (drafts.size === 0) return true;
    // Group by period — the API records one period at a time, which is also how
    // a site engineer works: this week's figures, then next week's.
    const byPeriod = new Map<string, { boqItemId: string; value: string }[]>();

    for (const [key, value] of drafts) {
      const [itemId, periodId] = key.split("|");
      if (!itemId || !periodId) continue;
      const list = byPeriod.get(periodId) ?? [];
      list.push({ boqItemId: itemId, value });
      byPeriod.set(periodId, list);
    }

    setSaving(true);
    try {
      for (const [periodId, changes] of byPeriod) {
        await bulkSave.mutateAsync({
          periodId,
          entries: changes.map((change) => {
            const item = rows.find((row) => row.leaf.id === change.boqItemId)?.leaf;
            // A blank cell clears the reading; it is not a reading of zero.
            const parsed = change.value.trim() === "" ? null : Number(change.value);
            const numeric = parsed !== null && Number.isFinite(parsed) ? parsed : null;

            return item?.progressMode === "by_percent"
              ? { boqItemId: change.boqItemId, cumulativePercent: numeric }
              : { boqItemId: change.boqItemId, cumulativeQuantity: numeric };
          }),
        });
      }

      setDrafts(new Map());
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      if (showSuccess) toast.success(t.progress.saved);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.progress.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  }

  const hasReadings = position.index >= 0;


  /*
   * What the user can do right now decides what they see first.
   *
   * The entry grid is the whole job while a period is open, and it used to sit
   * below four cards of figures it had not produced yet — the save action with
   * it. Once the period is submitted the opposite is true: the figures are the
   * point and the grid is read-only. Same components either way, ordered by
   * which of the two this is.
   */
  const selectedPeriod = periods.find((period) => period.id === effectiveSelectedPeriodId);
  const entryFirst = canEdit && Boolean(selectedPeriod && isEditable(selectedPeriod.status));
  /**
   * A selection here only means something against an open period.
   *
   * Both actions write into one period — clearing a reading and asserting there
   * was nothing to read are both statements about a particular week — so with
   * no editable period open there is nothing for a tick to do.
   */
  const canActOnSelection = entryFirst && selectedPeriod !== null;

  /**
   * Clears this period's readings on the selected lines.
   *
   * Writes nulls through bulkSave rather than blanking the drafts: a draft that
   * is never saved leaves the stored reading in place, and "clear" has to mean
   * the figure is gone, not that it is hidden. Which field is nulled follows
   * the line's own progressMode, exactly as save() does.
   */
  async function clearSelectedReadings() {
    if (!selectedPeriod || selection.selectedCount === 0) return;
    const targets = selection.selectedRows;
    try {
      await bulkSave.mutateAsync({
        periodId: selectedPeriod.id,
        entries: targets.map((row) =>
          row.leaf.progressMode === "by_percent"
            ? { boqItemId: row.leaf.id, cumulativePercent: null }
            : { boqItemId: row.leaf.id, cumulativeQuantity: null },
        ),
      });
      // Drop any unsaved edits to the same cells, or the grid would show a
      // draft figure over a reading that no longer exists.
      setDrafts((current) => {
        const next = new Map(current);
        for (const row of targets) next.delete(cellKey(row.leaf.id, selectedPeriod.id));
        return next;
      });
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(plural(t.progress.clearedToast, targets.length));
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.progress.saveFailed);
    }
  }

  /** Marks the selected lines as checked-and-unchanged for this period. */
  async function markSelectedNoProgress() {
    if (!selectedPeriod || selection.selectedCount === 0) return;
    const eligibleIds = selection.selectedRows
      .filter((row) => {
        const key = cellKey(row.leaf.id, selectedPeriod.id);
        return (
          !drafts.has(key) &&
          cellValue(row.leaf.id, selectedPeriod.id) === "" &&
          !entryByKey.get(key)?.noProgress
        );
      })
      .map((row) => row.leaf.id);
    if (eligibleIds.length === 0) {
      toast.success(interpolate(t.reporting.noProgressMarked, { count: 0 }));
      return;
    }
    try {
      const result = await markNoProgress.mutateAsync({
        periodId: selectedPeriod.id,
        boqItemIds: eligibleIds,
      });
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      toast.success(interpolate(t.reporting.noProgressMarked, { count: result.marked }));
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.progress.saveFailed);
    }
  }

  const reading = (
    <>
        <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t.progress.title}</CardTitle>
              <CardDescription>
                {dataDate ? interpolate(t.projects.asOf, { date: formatDate(dataDate) }) : t.progress.noReadings}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {periods.length === 0 ? (
                <p className="py-10 text-center text-muted-foreground">{t.schedule.noPeriods}</p>
              ) : (
                <SCurveChart
                  data={chartData}
                  describedById={SUMMARY_TABLE_ID}
                  dataDateLabel={currentPeriod ? String(currentPeriod.period.periodIndex) : null}
                />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t.progress.actualProgress}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {hasReadings ? `${position.actual.toFixed(1)}%` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t.progress.plannedToDate}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-semibold tabular-nums">
                  {hasReadings ? `${position.planned.toFixed(1)}%` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t.progress.deviationTile}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <p
                  className={`text-2xl font-semibold tabular-nums ${
                    hasReadings && isBehindDeviation(position.deviation) ? "text-destructive" : ""
                  }`}
                >
                  {hasReadings ? formatDeviation(position.deviation) : "—"}
                </p>
                {hasReadings && <DeviationBadge value={position.deviation} className="text-xs" />}
              </CardContent>
            </Card>
          </div>
        </div>

        {periods.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                {t.periodSummary.title}
                {/* "A blank is not a zero" is the rule this table lives or dies
                    by; it stays, as an icon rather than a paragraph. */}
                <Hint text={t.periodSummary.description} />
              </CardTitle>
            </CardHeader>
            <CardContent className="px-0">

              <PeriodSummaryTable id={SUMMARY_TABLE_ID} summary={summary} dataDate={dataDate} />
            </CardContent>
          </Card>
        )}

        {periods.length > 0 && (
          <DelayContributors
            contributors={contributors}
            dataDate={dataDate}
            totalDeviation={hasReadings ? position.deviation : null}
            actualSource={actualSource}
          />
        )}
    </>
  );

  const entry = (
    <>
        {periods.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-1.5">
                    {t.progress.matrixTitle}
                    {/* Cumulative, not this period's increment. Unguessable, and
                        getting it wrong silently corrupts the S-curve. */}
                    {/* One marker, not two. The fold is also unguessable, but a
                        second "i" beside the first reads as a rendering bug
                        rather than as a second thing worth knowing. */}
                    <Hint text={`${t.progress.matrixHint} ${t.progress.monthFoldedHint}`} />
                  </CardTitle>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={showFullMatrix ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={showFullMatrix}
                    aria-controls="progress-matrix-table"
                    // No longer "stop virtualising" but "stop constraining":
                    // every row, columns at full width, no folding of the
                    // fitter's own, and the sideways scroll that implies.
                    title={t.common.fullTableHint}
                    onClick={() => setShowFullMatrix((current) => !current)}
                  >
                    {t.common.fullTable}
                  </Button>
                  {canEdit && drafts.size > 0 && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setDrafts(new Map())}>
                        {t.progress.discard}
                      </Button>
                      <Button size="sm" disabled={saving} onClick={() => void save()}>
                        <Save />
                        {saving
                          ? t.progress.saving
                          : interpolate(t.progress.save, { count: drafts.size })}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="px-0">
              {/* The fold is visible on the band row; that it happened on its
                  own, because the window changed size, is not. */}
              <p className="sr-only" role="status" aria-live="polite">
                {fit.overflows
                  ? t.progress.tooWide
                  : fit.autoCollapsed.size > 0
                    ? plural(t.progress.autoFolded, fit.autoCollapsed.size)
                    : ""}
              </p>

              {canActOnSelection && (
                <div className="px-4 pb-2">
                  <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
                    {/* Both actions write into the open period, which is why the
                        bar only appears when one is open — and why the period is
                        named here, so it is never ambiguous which week is about
                        to change. */}
                    <span className="text-xs text-muted-foreground">
                      {selectedPeriod?.label ?? String(selectedPeriod?.periodIndex ?? "")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void markSelectedNoProgress()}
                    >
                      <CircleCheck />
                      {t.progress.markNoProgressSelected}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void clearSelectedReadings()}
                    >
                      <Trash2 />
                      {t.progress.clearSelected}
                    </Button>
                  </BulkActionsBar>
                </div>
              )}

              {/* The shared Table shell, not a hand-rolled one. The window
                  hook needs a handle on the scroll container — it measures it,
                  observes its <thead> and reads its offsets — which is what
                  containerRef and containerProps are for. overflow-y-auto
                  rather than overflow-auto: the primitive already sets
                  overflow-x-auto, and setting the shorthand alongside it is a
                  conflict that resolves by stylesheet order rather than by
                  intent. */}
                  <Table
                    id="progress-matrix-table"
                    containerRef={matrixWindow.scrollRef}
                    containerProps={{
                      role: "region",
                      "aria-label": t.progress.matrixTitle,
                      tabIndex: 0,
                      onScroll: matrixWindow.onScroll,
                      // One handler for every cell in the grid — see
                      // lib/use-matrix-keyboard.ts. Keys it does not act on keep
                      // their default, so Tab still leaves the grid.
                      onKeyDown: matrixKeyboard.onKeyDown,
                    }}
                    scrollX={scrollsSideways}
                    containerClassName={`max-h-[36rem] max-w-[120rem] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
                      showFullMatrix ? "" : "[overflow-anchor:none]"
                    } ${scrollsSideways ? "" : "overflow-x-clip"}`}
                    aria-rowcount={rows.length + 2}
                    aria-colcount={allMatrixColumns.length + 2}
                    className="table-fixed"
                    style={{
                      // The fitter has already divided the container between
                      // these columns, so this is the width it arrived at
                      // rather than a width the reader has to scroll to reach.
                      // minWidth only in the two states that can still exceed
                      // the container: "Full table", and a month the reader
                      // unfolded that will not fit however much is folded
                      // around it.
                      width: fit.tableWidth,
                      minWidth: scrollsSideways ? "100%" : undefined,
                    }}
                  >
                    <caption className="sr-only">
                      {t.progress.matrixTitle}. {t.progress.matrixHint}
                    </caption>
                    <colgroup>
                      {/* The leading block is still LEADING_WIDTH wide; it is
                          now divided rather than enlarged, so the fit maths
                          does not have to know the checkbox exists. */}
                      <col style={{ width: SELECT_WIDTH }} />
                      <col style={{ width: LEADING_WIDTH - SELECT_WIDTH }} />
                      {visibleColumns.map((column, index) => (
                        <col key={column.key} style={{ width: fit.columnWidths[index] }} />
                      ))}
                    </colgroup>
                    <TableHeader>
                    <WindowedMonthBandRow
                      header={visibleHeader}
                      leadingLabel={t.schedule.line}
                      leadingColSpan={2}
                      beforeSize={0}
                      afterSize={0}
                      onToggleMonth={toggleMonth}
                      gridId="progress-matrix-table"
                    />
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 h-auto bg-card px-2 py-2.5">
                        {canActOnSelection && (
                          <Checkbox
                            aria-label={t.progress.selectAllLines}
                            checked={selection.allSelected}
                            indeterminate={selection.someSelected}
                            onCheckedChange={selection.toggleAll}
                          />
                        )}
                      </TableHead>
                      <TableHead className="sticky left-10 z-10 h-auto bg-card px-2 py-2.5">
                        <span className="sr-only">{t.schedule.line}</span>
                      </TableHead>
                      {visibleHeader.columns.map((view, index) => {
                        // Narrowed here rather than via a `folded` boolean: the
                        // discriminant has to be read off the union itself for
                        // `.period` below to be known to exist.
                        const periodColumn =
                          view.column.kind === "period" ? view.column.period : null;
                        return (
                          <TableHead
                            key={view.column.key}
                            scope="col"
                            aria-colindex={index + 3}
                            aria-current={view.isCurrent ? "true" : undefined}
                            aria-label={[
                              view.accessibleName,
                              view.isCurrent ? t.periodSummary.current : null,
                              periodColumn !== null && !isEditable(periodColumn.status)
                                ? statusLabel(t, "period", periodColumn.status)
                                : null,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                            // Carries the dates a compact column had to drop.
                            title={compact ? view.accessibleName : undefined}
                            // h-auto: TableHead's fixed h-10 is sized for a
                            // one-line label, and these carry three.
                            //
                            // No w-24 any more. The colgroup owns the width now
                            // and a utility here would fight the fitted value
                            // it puts on the <col>.
                            className={`h-auto py-2 text-right ${
                              compact ? "px-1" : "px-2"
                            } ${view.isCurrent ? "border-b-2 border-b-[var(--chart-1)]" : ""}`}
                          >
                            {/* A folded column names the periods it swallowed —
                                "5–8" — rather than repeating the month, which the
                                band directly above it already says. */}
                            <span className="block tabular-nums">{view.number}</span>
                            {/* truncate + title: a folded month's range ("3-30 Mei") is the
                                longest label this row can hold, and at this column
                                width an untruncated one runs into its neighbour.
                                The full text stays reachable on the cell.

                                Below the compact threshold it goes entirely.
                                The range is the least load-bearing of the three
                                lines — the band above already names the month,
                                and the number above it names the period — and a
                                truncation that leaves "3-3…" is worse than an
                                honest omission. It stays in the title and in the
                                accessible name either way. */}
                            {!compact && (
                              <span
                                className="block truncate text-xs font-normal text-muted-foreground tabular-nums"
                                title={view.range}
                              >
                                {view.range}
                              </span>
                            )}
                            {view.isCurrent && (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {t.periodSummary.current}
                              </span>
                            )}
                            {periodColumn !== null && !isEditable(periodColumn.status) && (
                              <span className="block text-xs font-normal text-muted-foreground">
                                {statusLabel(t, "period", periodColumn.status)}
                              </span>
                            )}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                    </TableHeader>

                    <TableBody>
                    <MatrixRowSpacer
                      height={matrixWindow.rowWindow.beforeSize}
                      colSpan={renderedColumnCount}
                    />
                    {visibleRows.map((row, visibleRowIndex) => {
                      const rowIndex = matrixWindow.rowWindow.start + visibleRowIndex;
                      return (
                        <TableRow
                          key={row.leaf.id}
                          data-matrix-row-index={rowIndex}
                          aria-rowindex={rowIndex + 3}
                          data-state={
                            selection.isSelected(row.leaf.id) ? "selected" : undefined
                          }
                        >
                        <TableCell className="sticky left-0 z-10 bg-card px-2 py-1">
                          {canActOnSelection && (
                            <Checkbox
                              aria-label={interpolate(t.progress.selectLine, {
                                code: row.leaf.code,
                              })}
                              checked={selection.isSelected(row.leaf.id)}
                              onCheckedChange={() => selection.toggle(row.leaf.id)}
                            />
                          )}
                        </TableCell>

                        {/* A <th scope="row">, not a TableCell: the BoQ line is
                            what names the row, and every figure across it would
                            otherwise be unlabelled. Padding matches TableCell so
                            it lines up, and stays tight — ESTIMATED_ROW_HEIGHT
                            below is what the windowing scrolls by. */}
                        <th
                          scope="row"
                          className="sticky left-10 z-10 max-w-52 truncate bg-card px-2 py-2 text-left align-middle font-normal"
                          title={`${row.section} - ${row.leaf.description}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.leaf.code}
                          </span>{" "}
                          {row.leaf.description}
                          <span className="ml-1 text-xs text-muted-foreground">
                            (
                            {row.leaf.progressMode === "by_percent"
                              ? "%"
                              : (row.leaf.unit ?? t.boq.quantity.toLowerCase())}
                            )
                          </span>
                        </th>

                        {visibleHeader.columns.map(({ column, accessibleName }, index) => {
                          // A folded month shows the position it reached, which
                          // for a cumulative figure is the last period in it that
                          // holds a reading — never the sum, which would count the
                          // same work once per week of the month.
                          const period =
                            column.kind === "period" ? column.period : lastPeriodOf(column);
                          const key = cellKey(row.leaf.id, period.id);
                          // The workflow decides, not a status string compared in
                          // place — a submitted report is frozen for the reviewer
                          // just as firmly as a locked one is. A folded column is
                          // never editable: there is no single period for a typed
                          // figure to belong to, so it is read-only until unfolded.
                          const editable =
                            column.kind === "period" && canEdit && isEditable(period.status);

                          return (
                            <TableCell
                              key={column.key}
                              aria-colindex={index + 3}
                              className={`py-2 ${compact ? "px-1" : "px-1.5"}`}
                            >
                              {editable ? (
                                <Input
                                  // Not type="number", deliberately — see the
                                  // note on decimalOnly in ./matrix-input.ts.
                                  type="text"
                                  inputMode="decimal"
                                  value={cellValue(row.leaf.id, period.id)}
                                  aria-label={`${row.leaf.code} - ${accessibleName}`}
                                  {...matrixKeyboard.cellProps(rowIndex, index)}
                                  // px-1 once the column is compact. The Input
                                  // primitive spends 22px on its own padding and
                                  // borders before a digit is drawn, which at the
                                  // editable floor would leave under two
                                  // characters of typable interior.
                                  //
                                  // md:h-9 and md:text-sm have to name the
                                  // breakpoint: the primitive is `h-9 … md:h-8`
                                  // and `text-base … md:text-xs`, so a bare
                                  // utility here loses from `md` up, which is
                                  // every screen this grid is used on.
                                  className={`h-9 text-right tabular-nums md:h-9 ${
                                    compact ? "px-1" : "md:text-sm"
                                  } ${drafts.has(key) ? "border-[var(--chart-1)]" : ""}`}
                                  onChange={(e) =>
                                    setDrafts((current) =>
                                      new Map(current).set(key, decimalOnly(e.target.value)),
                                    )
                                  }
                                />
                              ) : (
                                <span
                                  className={`block py-1 text-right tabular-nums text-muted-foreground ${
                                    compact ? "px-1" : "px-2 text-sm"
                                  }`}
                                  title={
                                    column.kind === "month" ? accessibleName : undefined
                                  }
                                >
                                  {(column.kind === "month"
                                    ? foldedCellValue(row.leaf.id, column.periods)
                                    : cellValue(row.leaf.id, period.id)) || "—"}
                                </span>
                              )}
                              {/*
                               * An explicit "nothing moved here" is not the same
                               * as an empty cell, and the grid has to say so — it
                               * is the difference between a report that can be
                               * submitted and one that cannot.
                               */}
                              {column.kind === "period" && entryByKey.get(key)?.noProgress && (
                                <span className="mt-0.5 block text-center text-[10px] text-muted-foreground">
                                  {t.reporting.noProgressShort}
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                        </TableRow>
                      );
                    })}
                    <MatrixRowSpacer
                      height={matrixWindow.rowWindow.afterSize}
                      colSpan={renderedColumnCount}
                    />
                    </TableBody>
                  </Table>
            </CardContent>
          </Card>
        )}
    </>
  );

  return (
    <div className="space-y-3">
      <ReportingWorkflow
        projectId={projectId}
        canEdit={canEdit}
        canReview={canReview}
        canLock={canLock}
        selectedPeriodId={selectedPeriodId}
        onSelectPeriod={setSelectedPeriodId}
        onBeforeSubmit={() => save(false)}
      />

      {entryFirst ? entry : reading}
      {entryFirst ? reading : entry}
    </div>
  );
}
