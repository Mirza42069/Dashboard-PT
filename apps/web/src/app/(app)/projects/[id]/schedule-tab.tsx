"use client";

import { planDuration, weightPerPeriod } from "@DashboardV2/api/lib/schedule-plan";
import { Button } from "@DashboardV2/ui/components/button";
import { Badge } from "@DashboardV2/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import { DatePicker } from "@DashboardV2/ui/components/date-picker";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarRange,
  ChevronRight,
  Copy,
  Save,
  SlidersHorizontal,
  Trash2,
} from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import {
  MatrixRowSpacer,
  useMatrixWindow,
  WindowedMonthBandRow,
} from "@/components/matrix-window";
import { QueryError } from "@/components/query-error";
import { interpolate, plural } from "@/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@DashboardV2/ui/components/popover";

import { Hint } from "@/components/hint";
import { useLocale, useT } from "@/i18n/provider";
import { computePlannedCurve, distributionMap, scheduleRows } from "@/lib/boq/curves";
import { datePickerLabels } from "@/lib/date-picker-labels";
import {
  COMPACT_CELL_WIDTH,
  MAX_PERIOD_WIDTH,
  MIN_PERIOD_WIDTH_EDITABLE,
  MIN_PERIOD_WIDTH_READONLY,
  fitMatrix,
} from "@/lib/matrix-fit";
import { toggleFold, type MonthFoldState } from "@/lib/month-fold";
import { useMatrixKeyboard } from "@/lib/use-matrix-keyboard";
import { useRowSelection } from "@/lib/use-row-selection";
import { buildMatrixColumns, buildPeriodHeader, lastPeriodOf } from "@/lib/period-header";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { decimalOnly } from "./matrix-input";

/** A row is "complete" when its cells total 100, within rounding. */
const ROW_TOLERANCE = 0.5;

/**
 * Columns before the period grid: select, line.
 *
 * It used to be six. Start, finish, duration and weight-per-period spent 352px
 * of a laptop's width before a single week was drawn, which is why this grid
 * could not be fitted to the screen at all — the period columns were dividing
 * whatever was left of about 300px. They now live in the row's plan popover,
 * where the same editors do the same job without every row paying for them.
 *
 * Declared as widths and summed, rather than as a total restated beside the
 * <colgroup>: the fit arithmetic depends on the two agreeing, and they used to
 * be kept in step by hand.
 *
 * And every pixel of it comes out of the cells. fitMatrix divides whatever is
 * left of the container between the period columns, so these blocks are not
 * neutral chrome — they are the reason a cell was 56px wide. They were
 * [40, 256] and [88, 80]; the 64px trimmed off goes straight to the columns,
 * enough to lift several of them over COMPACT_CELL_WIDTH, which is what gates
 * the roomier padding and the second header line. The description column
 * truncates and carries its full text on `title`, so a narrower one hides
 * nothing.
 */
const LEADING_COL_WIDTHS = [40, 208] as const;
/**
 * Columns after it: row total, and the one button left on a row.
 *
 * The actions column was 72px holding three 28px buttons — 108px of content
 * once the cell's padding is counted. The table is `table-fixed`, so the column
 * could not grow; the row is `justify-end`, so the overflow went left; and a
 * table cell does not clip, so it painted over the total beside it. A row read
 * "100.(" with a sliders icon on top of the rest of it.
 *
 * Fill-right and copy-from went rather than the column growing: ticking a row
 * raises the bulk bar, which offers both already. What is left is the plan
 * popover — 28px inside 16px of padding — and the 24px saved goes to the
 * period columns like everything else trimmed here.
 */
const TRAILING_COL_WIDTHS = [80, 48] as const;
const sumWidths = (widths: readonly number[]) => widths.reduce((total, w) => total + w, 0);

const LEADING_COLUMNS = LEADING_COL_WIDTHS.length;
const TRAILING_COLUMNS = TRAILING_COL_WIDTHS.length;
const LEADING_WIDTH = sumWidths(LEADING_COL_WIDTHS);
const TRAILING_WIDTH = sumWidths(TRAILING_COL_WIDTHS);
/** Tracks the row padding below. The virtualiser scrolls by this. */
const ESTIMATED_ROW_HEIGHT = 52;
const ESTIMATED_HEADER_HEIGHT = 72;
const STICKY_LEADING_WIDTH = 40;

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

/** A start/finish pair being typed, before it is applied. */
type PlanDraft = { start: string; finish: string };

export default function ScheduleTab({
  projectId,
  canEdit,
  targetVersionId,
  setupMode = false,
  onReview,
}: {
  projectId: string;
  canEdit: boolean;
  targetVersionId?: string;
  setupMode?: boolean;
  onReview?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const queryClient = useQueryClient();

  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [planDrafts, setPlanDrafts] = useState<Map<string, PlanDraft>>(new Map());

  /** The line whose plan the bulk bar will paste. Set from a row's menu. */
  const [copySource, setCopySource] = useState<string | null>(null);
  const [bulkPlan, setBulkPlan] = useState<PlanDraft>({ start: "", finish: "" });
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showFullMatrix, setShowFullMatrix] = useState(false);
  /**
   * What the reader has said about each month — see the same state in
   * progress-tab.tsx and lib/month-fold.ts. The two grids fold independently,
   * because they are read for different reasons and rarely at the same width.
   */
  const [monthFold, setMonthFold] = useState<MonthFoldState>(() => new Map());

  const reportQuery = useQuery(
    trpc.progress.report.queryOptions({ projectId, versionId: targetVersionId }),
  );
  const matrixPeriods = reportQuery.data?.periods ?? [];
  // Built here rather than after the early returns, because the selection hook
  // below needs it and hooks cannot be called conditionally.
  const matrixRows = scheduleRows(reportQuery.data?.items ?? []);
  /**
   * The shared selection, replacing a hand-rolled Set that did the same job
   * slightly differently from every other table in the app.
   *
   * Keyed on `leaf.id`: a row here is `{ section, leaf }`, and the leaf is the
   * BoQ line every bulk action addresses.
   */
  const selection = useRowSelection(matrixRows, { getId: (row) => row.leaf.id });
  // Called before the fit: this is what measures the container the fit divides.
  // Its own column window is off, so the count it takes need only be stable.
  const matrixWindow = useMatrixWindow({
    rowCount: matrixRows.length,
    columnCount: matrixPeriods.length,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT,
    // Constant on purpose — the fitted width moves on every resize tick and
    // this value sits in the observer effect's dependency list.
    columnWidth: MAX_PERIOD_WIDTH,
    estimatedHeaderHeight: ESTIMATED_HEADER_HEIGHT,
    leadingWidth: LEADING_WIDTH,
    stickyLeadingWidth: STICKY_LEADING_WIDTH,
    windowed: !showFullMatrix,
    windowColumns: false,
  });
  const fit = fitMatrix({
    available: showFullMatrix ? 0 : matrixWindow.containerWidth,
    leadingWidth: LEADING_WIDTH,
    trailingWidth: TRAILING_WIDTH,
    periods: matrixPeriods,
    state: monthFold,
    minPeriodWidth: canEdit ? MIN_PERIOD_WIDTH_EDITABLE : MIN_PERIOD_WIDTH_READONLY,
    dataDate: reportQuery.data?.project.dataDate ?? null,
  });
  const allMatrixColumns = buildMatrixColumns(matrixPeriods, fit.collapsed);
  const matrixKeyboard = useMatrixKeyboard({
    scrollRef: matrixWindow.scrollRef,
    rowCount: matrixRows.length,
    columnCount: allMatrixColumns.length,
    rowHeight: ESTIMATED_ROW_HEIGHT,
  });

  function toggleMonth(monthKey: string) {
    // Against what is rendered, not what is stored: a month the fitter folded
    // has no stored intent to invert.
    const rendered = fit.collapsed.has(monthKey);
    setMonthFold((current) => toggleFold(current, monthKey, rendered));
  }
  const generatePeriods = useMutation(trpc.schedule.generatePeriods.mutationOptions());
  const setCells = useMutation(trpc.schedule.setDistributionCells.mutationOptions());
  const setItemPlan = useMutation(trpc.schedule.setItemPlan.mutationOptions());
  const copyPlan = useMutation(trpc.schedule.copyDistribution.mutationOptions());
  const clearPlan = useMutation(trpc.schedule.clearItemDistribution.mutationOptions());

  if (reportQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (reportQuery.isError) {
    return <QueryError error={reportQuery.error} onRetry={() => void reportQuery.refetch()} />;
  }

  const report = reportQuery.data;
  const version = report?.version ?? null;
  const items = report?.items ?? [];
  const periods = report?.periods ?? [];

  if (!version || items.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.schedule.title}</EmptyTitle>
              <EmptyDescription>{t.schedule.needsBoq}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  const versionId = version.id;
  const isDraft = version.scheduleStatus === "draft";
  const editable = canEdit && isDraft && (version.status === "draft" || version.status === "active");
  const settings = setupMode ? (
    <ScheduleSettings
      key={`${report?.project.startDate}-${report?.project.endDate}-${report?.project.scheduleStart}-${report?.project.periodType}`}
      projectId={projectId}
      versionId={versionId}
      startDate={report?.project.startDate ?? ""}
      endDate={report?.project.endDate ?? ""}
      scheduleStart={report?.project.scheduleStart ?? ""}
      periodType={report?.project.periodType ?? "weekly"}
      editable={editable && version.sourceVersionId === null}
      periodsExist={periods.length > 0}
    />
  ) : null;

  if (periods.length === 0) {
    return (
      <div className="space-y-3">
        {settings}
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t.schedule.noPeriods}</EmptyTitle>
                <EmptyDescription>{t.schedule.noPeriodsHint}</EmptyDescription>
              </EmptyHeader>
              {!setupMode && canEdit && (
                <Button
                  disabled={generatePeriods.isPending}
                  onClick={async () => {
                    try {
                      const result = await generatePeriods.mutateAsync({ projectId });
                      await queryClient.invalidateQueries(trpc.progress.pathFilter());
                      await queryClient.invalidateQueries(trpc.schedule.pathFilter());
                      toast.success(
                        interpolate(t.schedule.generated, { count: result.periods.length }),
                      );
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : t.common.somethingWentWrong,
                      );
                    }
                  }}
                >
                  <CalendarRange />
                  {t.schedule.generatePeriods}
                </Button>
              )}
            </Empty>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rows = matrixRows;
  const visibleRows = rows.slice(matrixWindow.rowWindow.start, matrixWindow.rowWindow.end);
  // Every column. Columns are no longer virtualised — the grid is fitted to
  // the card instead, so there is nothing off the side to leave unrendered.
  const visibleColumns = allMatrixColumns;
  const visibleHeader = buildPeriodHeader(
    format,
    visibleColumns,
    report?.project.dataDate ?? null,
    // The derived set, not the intent: a month the fitter folded still has to
    // be offered an unfold control, and only this knows it is folded.
    fit.collapsed,
  );
  /**
   * Where each period sits in the flat period list.
   *
   * The planned curves below are arrays indexed by period position, so a folded
   * column — which stands for several of them — needs their indices to add up or
   * to read the last of.
   */
  const periodIndexById = new Map(periods.map((period, index) => [period.id, index]));
  /**
   * One footer figure for one column.
   *
   * The curves are arrays indexed by period position; a column may stand for a
   * run of them. How the run reduces is the caller's business, because the two
   * footer rows differ on exactly that: per-period shares add up, running totals
   * do not.
   */
  function plannedForColumn(
    curve: number[],
    column: (typeof allMatrixColumns)[number],
    reduce: "sum" | "last",
  ): number {
    if (column.kind === "period") {
      return curve[periodIndexById.get(column.period.id) ?? -1] ?? 0;
    }
    if (reduce === "last") {
      return curve[periodIndexById.get(lastPeriodOf(column).id) ?? -1] ?? 0;
    }
    return column.periods.reduce(
      (total, period) => total + (curve[periodIndexById.get(period.id) ?? -1] ?? 0),
      0,
    );
  }

  const renderedColumnCount = LEADING_COLUMNS + visibleColumns.length + TRAILING_COLUMNS;
  /** The two states a fitted grid can still exceed its container in. */
  const scrollsSideways = showFullMatrix || fit.overflows;
  /** Narrow enough to hold a figure but not a caption under it. */
  const compact = fit.periodWidth < COMPACT_CELL_WIDTH;
  const firstIndex = periods[0]?.periodIndex ?? 1;
  const lastIndex = periods[periods.length - 1]?.periodIndex ?? 1;

  const cells = distributionMap(report?.distribution ?? []);
  for (const [key, value] of drafts) {
    const parsed = value.trim() === "" ? 0 : Number(value);
    if (Number.isFinite(parsed)) cells.set(key, parsed);
  }

  const planned = computePlannedCurve(rows, periods, cells);

  const rowTotal = (itemId: string) =>
    periods.reduce((total, period) => total + (cells.get(cellKey(itemId, period.id)) ?? 0), 0);

  /** What the start/finish inputs show: the pending edit, else what is stored. */
  function planValue(leaf: (typeof rows)[number]["leaf"]): PlanDraft {
    const draft = planDrafts.get(leaf.id);
    if (draft) return draft;
    return {
      start: leaf.plannedStartPeriodIndex === null ? "" : String(leaf.plannedStartPeriodIndex),
      finish: leaf.plannedFinishPeriodIndex === null ? "" : String(leaf.plannedFinishPeriodIndex),
    };
  }

  function parseWindow(draft: PlanDraft): { start: number | null; finish: number | null } {
    const start = draft.start.trim() === "" ? null : Number(draft.start);
    const finish = draft.finish.trim() === "" ? null : Number(draft.finish);
    return {
      start: start !== null && Number.isInteger(start) ? start : null,
      finish: finish !== null && Number.isInteger(finish) ? finish : null,
    };
  }

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries(trpc.progress.pathFilter()),
      queryClient.invalidateQueries(trpc.schedule.pathFilter()),
    ]);
  }

  /**
   * Applies a window and spreads the plan evenly across it.
   *
   * Written straight through rather than held as a draft: this is the one
   * gesture the tab exists for, and the whole point is seeing the row fill in.
   * Cell edits stay batched behind Save because those come many at a time.
   */
  async function applyPlan(
    entries: { boqItemId: string; startPeriodIndex: number | null; finishPeriodIndex: number | null }[],
  ) {
    setApplying(true);
    try {
      await setItemPlan.mutateAsync({ versionId, items: entries, mode: "even" });
      setPlanDrafts(new Map());
      await refresh();
      toast.success(interpolate(t.schedule.spreadDone, { count: entries.length }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
    } finally {
      setApplying(false);
    }
  }

  /**
   * Repeats the start period's value across the rest of the line's window.
   *
   * A draft edit, not a write — it lands in the same unsaved batch as anything
   * typed by hand, so it can be reviewed and discarded like one.
   */
  function fillRight(leaf: (typeof rows)[number]["leaf"]) {
    const { start, finish } = parseWindow(planValue(leaf));
    const from = start ?? firstIndex;
    const to = finish ?? lastIndex;
    const source = periods.find((period) => period.periodIndex === from);
    if (!source) return;

    const value = cells.get(cellKey(leaf.id, source.id)) ?? 0;
    setDrafts((current) => {
      const next = new Map(current);
      for (const period of periods) {
        if (period.periodIndex < from || period.periodIndex > to) continue;
        next.set(cellKey(leaf.id, period.id), String(value));
      }
      return next;
    });
  }

  async function save(afterSave?: () => void) {
    const changes = [...drafts].flatMap(([key, raw]) => {
      const [boqItemId, periodId] = key.split("|");
      const plannedPct = raw.trim() === "" ? 0 : Number(raw);
      return boqItemId && periodId && Number.isFinite(plannedPct) && plannedPct >= 0 && plannedPct <= 100
        ? [{ boqItemId, periodId, plannedPct }]
        : [];
    });
    if (changes.length !== drafts.size) {
      toast.error(t.schedule.invalidCells);
      return;
    }
    setSaving(true);
    try {
      await setCells.mutateAsync({ versionId, cells: changes });
      setDrafts(new Map());
      await refresh();
      toast.success(t.schedule.saved);
      afterSave?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const allComplete = rows.every((row) => Math.abs(rowTotal(row.leaf.id) - 100) <= ROW_TOLERANCE);
  const selectedRows = selection.selectedRows;
  const sourceRow = rows.find((row) => row.leaf.id === copySource);
  /**
   * Picking the source is a per-row act, so the bar only offers it when the
   * selection *is* one row. It replaces a button that sat on every row and
   * overflowed the actions column onto the row total.
   */
  const lone = selectedRows.length === 1 ? selectedRows[0] : undefined;
  /**
   * Never the source itself. The old per-row picker could not put the source in
   * the selection without also making it a target, and copying a row's plan
   * onto itself did nothing but report a line it had not changed.
   */
  const copyTargets = selectedRows.filter((row) => row.leaf.id !== copySource);

  return (
    <div className="space-y-3">
      {settings}

      {editable && (
        <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="bulk-start" className="text-xs text-muted-foreground">
              {t.schedule.planStart}
            </Label>
            <Input
              id="bulk-start"
              type="number"
              inputMode="numeric"
              min={firstIndex}
              max={lastIndex}
              value={bulkPlan.start}
              className="h-8 w-16 text-right tabular-nums"
              onChange={(e) => setBulkPlan((current) => ({ ...current, start: e.target.value }))}
            />
            <Label htmlFor="bulk-finish" className="text-xs text-muted-foreground">
              {t.schedule.planFinish}
            </Label>
            <Input
              id="bulk-finish"
              type="number"
              inputMode="numeric"
              min={firstIndex}
              max={lastIndex}
              value={bulkPlan.finish}
              className="h-8 w-16 text-right tabular-nums"
              onChange={(e) => setBulkPlan((current) => ({ ...current, finish: e.target.value }))}
            />
            <Button
              size="sm"
              disabled={applying || bulkPlan.start === "" || bulkPlan.finish === ""}
              onClick={() => {
                const { start, finish } = parseWindow(bulkPlan);
                if (start === null || finish === null) return;
                void applyPlan(
                  selectedRows.map((row) => ({
                    boqItemId: row.leaf.id,
                    startPeriodIndex: start,
                    finishPeriodIndex: finish,
                  })),
                );
              }}
            >
              <ChevronRight />
              {t.schedule.spreadSelected}
            </Button>

            {/* Marking the row you want to copy *from*. This was an icon on
                every row; here it costs one tick, and the row it marks is the
                one the bar is already naming. */}
            {lone && (
              <Button
                variant={copySource === lone.leaf.id ? "secondary" : "outline"}
                size="sm"
                aria-pressed={copySource === lone.leaf.id}
                onClick={() =>
                  setCopySource((current) =>
                    current === lone.leaf.id ? null : lone.leaf.id,
                  )
                }
              >
                <Copy />
                {t.schedule.useAsCopySource}
              </Button>
            )}

            {sourceRow && copyTargets.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={copyPlan.isPending}
                onClick={async () => {
                  try {
                    const result = await copyPlan.mutateAsync({
                      versionId,
                      sourceItemId: sourceRow.leaf.id,
                      targetItemIds: copyTargets.map((row) => row.leaf.id),
                    });
                    await refresh();
                    toast.success(interpolate(t.schedule.copyDone, { count: result.copied }));
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
                  }
                }}
              >
                <Copy />
                {`${t.schedule.copyFrom} ${sourceRow.leaf.code}`}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={clearPlan.isPending}
              onClick={async () => {
                try {
                  const result = await clearPlan.mutateAsync({
                    versionId,
                    boqItemIds: selectedRows.map((row) => row.leaf.id),
                  });
                  await refresh();
                  toast.success(interpolate(t.schedule.clearDone, { count: result.cleared }));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
                }
              }}
            >
              <Trash2 />
              {t.schedule.clearSelected}
            </Button>
            {/* Fill-right was already a per-row action; over a selection it is
                the same pure draft edit repeated, so it costs nothing on the
                server and saves the most tedious pass over a wide grid.

                It carries the hint the per-row button used to show in a
                tooltip — this is the only fill-right there is now. */}
            <Button
              variant="outline"
              size="sm"
              title={t.schedule.fillRightHint}
              onClick={() => {
                for (const row of selectedRows) fillRight(row.leaf);
                toast.success(
                  interpolate(t.schedule.fillRightDone, { count: selectedRows.length }),
                );
              }}
            >
              <ChevronRight />
              {t.schedule.fillRightSelected}
            </Button>
          </div>
        </BulkActionsBar>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                {t.schedule.title}
                <Badge variant={isDraft ? "outline" : "secondary"}>
                  {isDraft ? t.boq.draft : t.boq.active}
                </Badge>
                <Hint
                  text={`${editable ? t.schedule.planHint : t.schedule.lockedNote} ${t.progress.monthFoldedHint}`}
                />
              </CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={showFullMatrix ? "secondary" : "outline"}
                size="sm"
                aria-pressed={showFullMatrix}
                aria-controls="schedule-matrix-table"
                title={t.common.fullTableHint}
                onClick={() => setShowFullMatrix((current) => !current)}
              >
                {t.common.fullTable}
              </Button>
              {editable && drafts.size > 0 && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setDrafts(new Map())}>
                    {t.schedule.discard}
                  </Button>
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => void save(setupMode ? onReview : undefined)}
                  >
                    <Save />
                    {saving
                      ? t.schedule.saving
                      : setupMode
                        ? t.baseline.saveReview
                        : interpolate(t.schedule.save, { count: drafts.size })}
                  </Button>
                </>
              )}
              {editable && setupMode && drafts.size === 0 && onReview && (
                <Button size="sm" disabled={!allComplete} onClick={onReview}>
                  {t.baseline.reviewBaseline}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          {/* The fold is visible on the band row; that it happened on its own,
              because the window changed size, is not. */}
          <p className="sr-only" role="status" aria-live="polite">
            {fit.overflows
              ? t.progress.tooWide
              : fit.autoCollapsed.size > 0
                ? plural(t.progress.autoFolded, fit.autoCollapsed.size)
                : ""}
          </p>

          {/* The shared Table shell — see the matching note in progress-tab.tsx
              for why the window hook needs containerRef, and why this asks for
              overflow-y-auto rather than the overflow-auto shorthand. */}
              <Table
                id="schedule-matrix-table"
                containerRef={matrixWindow.scrollRef}
                containerProps={{
                  role: "region",
                  "aria-label": t.schedule.title,
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
                aria-rowcount={rows.length + 4}
                aria-colcount={LEADING_COLUMNS + allMatrixColumns.length + TRAILING_COLUMNS}
                className="table-fixed"
                style={{
                  // The width the fitter arrived at, not one the reader has to
                  // scroll to reach. minWidth only where the grid can still
                  // exceed the container: "Full table", or an unfold that will
                  // not fit however much is folded around it.
                  width: fit.tableWidth,
                  minWidth: scrollsSideways ? "100%" : undefined,
                }}
              >
                <caption className="sr-only">
                  {t.schedule.title}. {t.schedule.planHint}
                </caption>
                {/* Rendered from the width arrays, so the <colgroup> and the
                    fit arithmetic cannot drift apart. */}
                <colgroup>
                  {LEADING_COL_WIDTHS.map((width, index) => (
                    <col key={`leading-${index}`} style={{ width }} />
                  ))}
                  {visibleColumns.map((column, index) => (
                    <col key={column.key} style={{ width: fit.columnWidths[index] }} />
                  ))}
                  {TRAILING_COL_WIDTHS.map((width, index) => (
                    <col key={`trailing-${index}`} style={{ width }} />
                  ))}
                </colgroup>
                <TableHeader>
                  <WindowedMonthBandRow
                    header={visibleHeader}
                    leadingLabel={t.schedule.line}
                    leadingColSpan={LEADING_COLUMNS}
                    trailingColSpan={TRAILING_COLUMNS}
                    beforeSize={0}
                    afterSize={0}
                    onToggleMonth={toggleMonth}
                    gridId="schedule-matrix-table"
                  />
                  <TableRow>
                    <TableHead
                      className="sticky left-0 z-10 h-auto bg-card px-2 py-2.5"
                    >
                      {editable && (
                        <Checkbox
                          aria-label={t.schedule.selectAll}
                          checked={selection.allSelected}
                          indeterminate={selection.someSelected}
                          onCheckedChange={selection.toggleAll}
                        />
                      )}
                    </TableHead>
                    {/* Start, finish, duration and weight/period used to be four
                        more columns here. They are in the row's plan popover
                        now; the width they cost every row is what the period
                        columns are spending instead. */}
                    <TableHead scope="col" className="sticky left-10 z-10 h-auto bg-card px-2 py-2.5">
                      {t.schedule.line}
                    </TableHead>
                    {visibleHeader.columns.map((view, index) => (
                      <TableHead
                        key={view.column.key}
                        scope="col"
                        aria-colindex={LEADING_COLUMNS + index + 1}
                        aria-current={view.isCurrent ? "true" : undefined}
                        aria-label={view.accessibleName}
                        // h-auto: these headers carry two lines, and TableHead's
                        // h-10 is sized for one.
                        //
                        // No w-20: the colgroup owns the width now, and a
                        // utility here would fight the fitted value on the <col>.
                        className={`h-auto py-2 text-right ${compact ? "px-1" : "px-2"} ${
                          view.isCurrent ? "border-b-2 border-b-[var(--chart-1)]" : ""
                        }`}
                        title={compact ? view.accessibleName : undefined}
                      >
                        {/* A folded column names the periods inside it — "5–8" —
                            rather than repeating the month above it. */}
                        <span className="block tabular-nums">{view.number}</span>
                        {/* truncate + title: a folded month's range ("3-30 Mei") is the
                                longest label this row can hold, and at this column
                                width an untruncated one runs into its neighbour.
                                The full text stays reachable on the cell.

                                Dropped entirely below the compact width, where a
                                truncation would leave "3-3…". The month band above
                                already names the month and the number above it
                                names the period; the range is the line that can
                                go. It survives in the cell's title. */}
                        {!compact && (
                          <span
                            className="block truncate text-xs font-normal text-muted-foreground tabular-nums"
                            title={view.range}
                          >
                            {view.range}
                          </span>
                        )}
                      </TableHead>
                    ))}
                    <TableHead
                      scope="col"
                      aria-colindex={LEADING_COLUMNS + allMatrixColumns.length + 1}
                      // No width here: the <colgroup> owns it under
                      // table-fixed, and the 88 and 80 that used to sit on these
                      // two never applied — they only disagreed with
                      // TRAILING_COL_WIDTHS.
                      className="h-auto px-3 py-2.5 text-right"
                    >
                      {t.schedule.rowTotal}
                    </TableHead>
                    <TableHead
                      scope="col"
                      aria-colindex={LEADING_COLUMNS + allMatrixColumns.length + 2}
                      className="h-auto px-2 py-2.5"
                    >
                      <span className="sr-only">{t.common.actions}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  <MatrixRowSpacer
                    height={matrixWindow.rowWindow.beforeSize}
                    colSpan={renderedColumnCount}
                  />
                  {visibleRows.map((row, visibleRowIndex) => {
                    const rowIndex = matrixWindow.rowWindow.start + visibleRowIndex;
                    const total = rowTotal(row.leaf.id);
                    const isComplete = Math.abs(total - 100) <= ROW_TOLERANCE;
                    const draft = planValue(row.leaf);
                    const { start, finish } = parseWindow(draft);
                    const duration = planDuration(start, finish);
                    const invertedWindow =
                      start !== null && finish !== null && finish < start;
                    const rate = weightPerPeriod(row.leaf.weight, duration);
                    const errorId = `plan-error-${row.leaf.id}`;

                    const commit = () => {
                      const stored = {
                        start: row.leaf.plannedStartPeriodIndex,
                        finish: row.leaf.plannedFinishPeriodIndex,
                      };
                      if (invertedWindow) return;
                      if (start === stored.start && finish === stored.finish) return;
                      if ((start === null) !== (finish === null)) return;
                      void applyPlan([
                        {
                          boqItemId: row.leaf.id,
                          startPeriodIndex: start,
                          finishPeriodIndex: finish,
                        },
                      ]);
                    };

                    return (
                      <TableRow
                        key={row.leaf.id}
                        data-matrix-row-index={rowIndex}
                        aria-rowindex={rowIndex + 3}
                        // The grid had no selected-row tint at all, which on a
                        // wide matrix means the checkbox scrolls out of sight
                        // vertically and nothing else says the row is ticked.
                        // The Table primitive already styles this attribute.
                        data-state={selection.isSelected(row.leaf.id) ? "selected" : undefined}
                      >
                        <TableCell className="sticky left-0 z-10 bg-card px-2 py-1">
                          {editable && (
                            <Checkbox
                              aria-label={interpolate(t.schedule.selectRow, { code: row.leaf.code })}
                              checked={selection.isSelected(row.leaf.id)}
                              onCheckedChange={() => selection.toggle(row.leaf.id)}
                            />
                          )}
                        </TableCell>

                        {/* A <th scope="row">: the BoQ line names the row. Kept
                            tight — ESTIMATED_ROW_HEIGHT is what the windowing
                            scrolls by, so the padding here is load-bearing. */}
                        <th
                          scope="row"
                          className="sticky left-10 z-10 max-w-52 truncate bg-card px-2 py-2 text-left align-middle font-normal"
                          title={`${row.section} - ${row.leaf.description}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.leaf.code}
                          </span>{" "}
                          {row.leaf.description}
                        </th>

                        {/* Start, finish, duration and weight/period were four
                            columns here. They live in the plan popover in the
                            actions cell now: the same editors on the same commit
                            path, no longer costing every row 352px of width. */}
                        {visibleHeader.columns.map(({ column, accessibleName }, index) => {
                          // Planned percentages are per-period shares of the
                          // line, so a folded month is their sum — unlike the
                          // progress grid, whose cumulative figures must not be
                          // added. Same fold, opposite arithmetic.
                          const folded = column.kind === "month";
                          const period =
                            column.kind === "period" ? column.period : lastPeriodOf(column);
                          const value = folded
                            ? column.periods.reduce(
                                (total, item) =>
                                  total + (cells.get(cellKey(row.leaf.id, item.id)) ?? 0),
                                0,
                              )
                            : (cells.get(cellKey(row.leaf.id, period.id)) ?? 0);
                          const key = cellKey(row.leaf.id, period.id);
                          return (
                            <TableCell
                              key={column.key}
                              aria-colindex={
                                LEADING_COLUMNS + index + 1
                              }
                              className={`py-2 ${compact ? "px-1" : "px-1.5"}`}
                            >
                              {editable && !folded ? (
                                <Input
                                  // Not type="number", deliberately — see the
                                  // note on decimalOnly in ./matrix-input.ts.
                                  type="text"
                                  inputMode="decimal"
                                  value={drafts.get(key) ?? (value === 0 ? "" : String(value))}
                                  aria-label={`${row.leaf.code} - ${accessibleName}`}
                                  {...matrixKeyboard.cellProps(rowIndex, index)}
                                  // px-1 once the column is compact: the Input
                                  // primitive spends 22px on padding and borders
                                  // before a digit is drawn.
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
                                  title={folded ? accessibleName : undefined}
                                >
                                  {value === 0 ? "—" : folded ? value.toFixed(1) : value}
                                </span>
                              )}
                            </TableCell>
                          );
                        })}

                        <TableCell
                          aria-colindex={LEADING_COLUMNS + allMatrixColumns.length + 1}
                          className={`px-3 py-1 text-right tabular-nums ${
                            isComplete ? "text-muted-foreground" : "font-medium text-destructive"
                          }`}
                        >
                          {total.toFixed(1)}%
                          {!isComplete && (
                            <span className="sr-only">
                              {" "}
                              {interpolate(t.schedule.rowIncomplete, {
                                total: `${total.toFixed(1)}%`,
                              })}
                            </span>
                          )}
                        </TableCell>

                        <TableCell
                          aria-colindex={LEADING_COLUMNS + allMatrixColumns.length + 2}
                          className="px-2 py-1"
                        >
                          <div className="flex justify-end">
                            {/* The plan window, which used to be four columns on
                                every row. A popover rather than a dialog: it is
                                a two-field edit that commits on blur, and the
                                grid behind it is the context for what is being
                                set.

                                The only button on a row now. Fill-right and
                                copy-from stood beside it and overflowed the
                                column onto the total; both are in the bulk bar,
                                one tick away. */}
                            <Popover>
                                <PopoverTrigger
                                  render={
                                    <Button
                                      variant={
                                        invertedWindow
                                          ? "destructive"
                                          : duration > 0
                                            ? "secondary"
                                            : "ghost"
                                      }
                                      size="icon-sm"
                                      aria-label={interpolate(t.schedule.rowActions, {
                                        code: row.leaf.code,
                                      })}
                                    />
                                  }
                                >
                                  <SlidersHorizontal />
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-72 space-y-3">
                                  <p className="text-sm font-medium">
                                    {row.leaf.code} · {t.schedule.planStart} /{" "}
                                    {t.schedule.planFinish}
                                  </p>
                                  <div className="flex items-end gap-2">
                                    <PlanField
                                      value={draft.start}
                                      label={t.schedule.planStart}
                                      name={`plan-start-${row.leaf.id}`}
                                      min={firstIndex}
                                      max={lastIndex}
                                      readOnly={!editable}
                                      invalid={invertedWindow}
                                      describedBy={invertedWindow ? errorId : undefined}
                                      onChange={(next) =>
                                        setPlanDrafts((current) =>
                                          new Map(current).set(row.leaf.id, {
                                            ...draft,
                                            start: next,
                                          }),
                                        )
                                      }
                                      onCommit={commit}
                                    />
                                    <PlanField
                                      value={draft.finish}
                                      label={t.schedule.planFinish}
                                      name={`plan-finish-${row.leaf.id}`}
                                      min={firstIndex}
                                      max={lastIndex}
                                      readOnly={!editable}
                                      invalid={invertedWindow}
                                      describedBy={invertedWindow ? errorId : undefined}
                                      onChange={(next) =>
                                        setPlanDrafts((current) =>
                                          new Map(current).set(row.leaf.id, {
                                            ...draft,
                                            finish: next,
                                          }),
                                        )
                                      }
                                      onCommit={commit}
                                    />
                                  </div>
                                  {/* The error sits with the fields rather than
                                      in a tooltip, so it is announced with them
                                      and survives a keyboard-only pass. */}
                                  {invertedWindow && (
                                    <p
                                      id={errorId}
                                      className="text-xs font-medium text-destructive"
                                    >
                                      {t.schedule.finishBeforeStart}
                                    </p>
                                  )}
                                  <dl className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                                    <dt>{t.schedule.planDuration}</dt>
                                    <dd className="text-right tabular-nums">
                                      {duration > 0 ? duration : t.schedule.notScheduled}
                                    </dd>
                                    <dt>{t.schedule.planWeightPerPeriod}</dt>
                                    <dd className="text-right tabular-nums">
                                      {rate === null ? "—" : rate.toFixed(3)}
                                    </dd>
                                  </dl>
                                  <p className="text-xs text-muted-foreground">
                                    {t.schedule.planHint}
                                  </p>
                                </PopoverContent>
                            </Popover>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <MatrixRowSpacer
                    height={matrixWindow.rowWindow.afterSize}
                    colSpan={renderedColumnCount}
                  />
                </TableBody>

                {/* TableFooter already carries the top rule and the muted
                    ground; border-t-2 keeps the heavier rule this grid used to
                    separate the totals from the lines. */}
                <TableFooter className="border-t-2">
                  <TableRow aria-rowindex={rows.length + 3}>
                    <th
                      scope="row"
                      colSpan={LEADING_COLUMNS}
                      className="sticky left-0 z-10 bg-card px-4 py-2 text-left align-middle font-medium"
                    >
                      {t.schedule.plannedPerPeriod}
                    </th>
                    {/* Indexed by column, not by period: these arrays are one
                        entry per period, so a folded column has to gather the
                        entries it covers rather than take the one that happens
                        to sit at its position. */}
                    {visibleColumns.map((column, index) => (
                      <TableCell
                        key={column.key}
                        aria-colindex={
                          LEADING_COLUMNS + index + 1
                        }
                        className="px-2 py-2 text-right tabular-nums text-muted-foreground"
                      >
                        {plannedForColumn(planned.perPeriod, column, "sum").toFixed(1)}
                      </TableCell>
                    ))}
                    <TableCell colSpan={TRAILING_COLUMNS} />
                  </TableRow>
                  <TableRow aria-rowindex={rows.length + 4}>
                    <th
                      scope="row"
                      colSpan={LEADING_COLUMNS}
                      className="sticky left-0 z-10 bg-card px-4 py-2 text-left align-middle font-medium"
                    >
                      {t.schedule.plannedCumulative}
                    </th>
                    {/* Cumulative, so a folded month is where it *ended*, never
                        the sum of the running totals inside it. */}
                    {visibleColumns.map((column, index) => (
                      <TableCell
                        key={column.key}
                        aria-colindex={
                          LEADING_COLUMNS + index + 1
                        }
                        className="px-2 py-2 text-right font-medium tabular-nums"
                      >
                        {plannedForColumn(planned.cumulative, column, "last").toFixed(1)}
                      </TableCell>
                    ))}
                    <TableCell colSpan={TRAILING_COLUMNS} />
                  </TableRow>
                </TableFooter>
              </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * One end of a planning window.
 *
 * A number input rather than a period picker: filling a hundred lines means
 * typing "3", tab, "17", tab, and a listbox of sixty dated options turns that
 * into sixty scroll-and-click gestures. The dates are one column away in the
 * header, which is where someone reads them from anyway.
 */
/**
 * One end of a line's planning window, as a labelled field.
 *
 * It used to render its own <TableCell> and live in the grid. The cell went
 * when start and finish moved into the row's plan popover; what is left is the
 * input and its label, because a popover has room for a label and a 72px
 * column never did.
 */
function PlanField({
  value,
  label,
  name,
  min,
  max,
  readOnly,
  invalid,
  describedBy,
  onChange,
  onCommit,
}: {
  value: string;
  label: string;
  name: string;
  min: number;
  max: number;
  /**
   * An active baseline's distribution is fixed, so the fields state the window
   * rather than offering to change it. Read-only rather than disabled: the
   * value is still the answer someone opened this to read, and a disabled
   * input is skipped by the keyboard and dimmed past comfortable reading.
   */
  readOnly: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex-1 space-y-1">
      <Label htmlFor={name} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-8 text-right tabular-nums"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        // Enter applies without closing the popover, so both ends of a window
        // can be typed without reaching for the mouse in between.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
      />
    </div>
  );
}

function ScheduleSettings({
  projectId,
  versionId,
  startDate: initialStartDate,
  endDate: initialEndDate,
  scheduleStart: initialScheduleStart,
  periodType: initialPeriodType,
  editable,
  periodsExist,
}: {
  projectId: string;
  versionId: string;
  startDate: string;
  endDate: string;
  scheduleStart: string;
  periodType: "weekly" | "biweekly" | "monthly";
  editable: boolean;
  periodsExist: boolean;
}) {
  const t = useT();
  const { intlLocale } = useLocale();
  const { formatDate } = useFormat();
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [scheduleStart, setScheduleStart] = useState(initialScheduleStart);
  const [periodType, setPeriodType] = useState(initialPeriodType);
  const updateSettings = useMutation(trpc.schedule.updateSettings.mutationOptions());
  const generatePeriods = useMutation(trpc.schedule.generatePeriods.mutationOptions());
  const periodTypeOptions = [
    { value: "weekly", label: t.projects.periodWeekly },
    { value: "biweekly", label: t.projects.periodBiweekly },
    { value: "monthly", label: t.projects.periodMonthly },
  ];

  async function saveAndGenerate() {
    if (!startDate || !endDate) {
      toast.error(t.schedule.needsDates);
      return;
    }
    try {
      await updateSettings.mutateAsync({
        projectId,
        versionId,
        startDate,
        endDate,
        scheduleStart: scheduleStart || null,
        periodType,
      });
      const result = await generatePeriods.mutateAsync({ projectId });
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.schedule.pathFilter());
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(interpolate(t.schedule.generated, { count: result.periods.length }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          {t.baseline.timingTitle}
          <Hint text={editable ? t.baseline.timingHint : t.baseline.timingLocked} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Same picker the new/edit dialog uses. These are the same two columns
            on the same project, so two different date UIs for them was the first
            inconsistency anyone noticed. */}
        <div className="space-y-2">
          <Label htmlFor="baseline-start">{t.projects.startDate}</Label>
          <DatePicker
            id="baseline-start"
            value={startDate || null}
            // Unbounded on purpose — see the note in project-form-dialog.tsx.
            disabled={!editable}
            locale={intlLocale}
            formatValue={formatDate}
            labels={datePickerLabels(t)}
            onValueChange={(next) => setStartDate(next ?? "")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baseline-end">{t.projects.endDate}</Label>
          <DatePicker
            id="baseline-end"
            value={endDate || null}
            min={startDate || null}
            disabled={!editable}
            locale={intlLocale}
            formatValue={formatDate}
            labels={datePickerLabels(t)}
            onValueChange={(next) => setEndDate(next ?? "")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baseline-reporting-start">{t.projects.scheduleStart}</Label>
          <DatePicker
            id="baseline-reporting-start"
            value={scheduleStart || null}
            min={startDate || null}
            max={endDate || null}
            disabled={!editable}
            locale={intlLocale}
            formatValue={formatDate}
            labels={datePickerLabels(t)}
            onValueChange={(next) => setScheduleStart(next ?? "")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baseline-cadence">{t.projects.periodType}</Label>
          <Select
            items={periodTypeOptions}
            value={periodType}
            disabled={!editable}
            onValueChange={(value) =>
              setPeriodType((value ?? "weekly") as "weekly" | "biweekly" | "monthly")
            }
          >
            <SelectTrigger id="baseline-cadence" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodTypeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {editable && (
          <div className="sm:col-span-2 lg:col-span-4">
            <Button
              variant="outline"
              disabled={updateSettings.isPending || generatePeriods.isPending}
              onClick={() => void saveAndGenerate()}
            >
              <CalendarRange />
              {periodsExist ? t.schedule.regenerate : t.schedule.generatePeriods}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
