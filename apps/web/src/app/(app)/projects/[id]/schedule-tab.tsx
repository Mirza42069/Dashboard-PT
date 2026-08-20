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
  Trash2,
} from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import {
  MatrixColumnSpacer,
  MatrixRowSpacer,
  useMatrixWindow,
  WindowedMonthBandRow,
} from "@/components/matrix-window";
import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@DashboardV2/ui/components/tooltip";

import { Hint } from "@/components/hint";
import { useLocale, useT } from "@/i18n/provider";
import { computePlannedCurve, distributionMap, scheduleRows } from "@/lib/boq/curves";
import { datePickerLabels } from "@/lib/date-picker-labels";
import { buildPeriodHeader } from "@/lib/period-header";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/** A row is "complete" when its cells total 100, within rounding. */
const ROW_TOLERANCE = 0.5;

/** Columns before the period grid: select, line, start, finish, duration, rate. */
const LEADING_COLUMNS = 6;
/** Columns after it: row total and the row menu. */
const TRAILING_COLUMNS = 2;
const ESTIMATED_ROW_HEIGHT = 44;
const PERIOD_WIDTH = 80;
const ESTIMATED_HEADER_HEIGHT = 72;
const LEADING_WIDTH = 648;
const STICKY_LEADING_WIDTH = 40;
const TRAILING_WIDTH = 168;

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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The line whose plan the bulk bar will paste. Set from a row's menu. */
  const [copySource, setCopySource] = useState<string | null>(null);
  const [bulkPlan, setBulkPlan] = useState<PlanDraft>({ start: "", finish: "" });
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showFullMatrix, setShowFullMatrix] = useState(false);

  const reportQuery = useQuery(
    trpc.progress.report.queryOptions({ projectId, versionId: targetVersionId }),
  );
  const matrixWindow = useMatrixWindow({
    rowCount: scheduleRows(reportQuery.data?.items ?? []).length,
    columnCount: reportQuery.data?.periods.length ?? 0,
    estimatedRowHeight: ESTIMATED_ROW_HEIGHT,
    columnWidth: PERIOD_WIDTH,
    estimatedHeaderHeight: ESTIMATED_HEADER_HEIGHT,
    leadingWidth: LEADING_WIDTH,
    stickyLeadingWidth: STICKY_LEADING_WIDTH,
    windowed: !showFullMatrix,
  });
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

  const rows = scheduleRows(items);
  const visibleRows = rows.slice(matrixWindow.rowWindow.start, matrixWindow.rowWindow.end);
  const visiblePeriods = periods.slice(
    matrixWindow.columnWindow.start,
    matrixWindow.columnWindow.end,
  );
  const visibleHeader = buildPeriodHeader(
    format,
    visiblePeriods,
    report?.project.dataDate ?? null,
  );
  const renderedColumnCount =
    LEADING_COLUMNS +
    visiblePeriods.length +
    TRAILING_COLUMNS +
    Number(matrixWindow.columnWindow.beforeSize > 0) +
    Number(matrixWindow.columnWindow.afterSize > 0);
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
  const selectedRows = rows.filter((row) => selected.has(row.leaf.id));
  const sourceRow = rows.find((row) => row.leaf.id === copySource);

  return (
    <div className="space-y-3">
      {settings}

      {editable && (
        <BulkActionsBar count={selected.size} onClear={() => setSelected(new Set())}>
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

            {sourceRow && (
              <Button
                variant="outline"
                size="sm"
                disabled={copyPlan.isPending}
                onClick={async () => {
                  try {
                    const result = await copyPlan.mutateAsync({
                      versionId,
                      sourceItemId: sourceRow.leaf.id,
                      targetItemIds: selectedRows.map((row) => row.leaf.id),
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
                <Hint text={editable ? t.schedule.planHint : t.schedule.lockedNote} />
              </CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={showFullMatrix ? "secondary" : "outline"}
                size="sm"
                aria-pressed={showFullMatrix}
                aria-controls="schedule-matrix-table"
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
          <div className="relative">
            {/* Overflow cue — see the note in period-summary-table.tsx. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-card to-transparent"
            />
            <div
              ref={matrixWindow.scrollRef}
              role="region"
              aria-label={t.schedule.title}
              tabIndex={0}
              onScroll={matrixWindow.onScroll}
              className={`max-h-[36rem] max-w-[120rem] overflow-auto overscroll-contain [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
                showFullMatrix ? "" : "[overflow-anchor:none]"
              }`}
            >
              <table
                id="schedule-matrix-table"
                aria-rowcount={rows.length + 4}
                aria-colcount={LEADING_COLUMNS + periods.length + TRAILING_COLUMNS}
                className="table-fixed text-sm"
                style={{
                  width: LEADING_WIDTH + periods.length * PERIOD_WIDTH + TRAILING_WIDTH,
                  minWidth: "100%",
                }}
              >
                <caption className="sr-only">
                  {t.schedule.title}. {t.schedule.planHint}
                </caption>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 256 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 72 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 112 }} />
                  {matrixWindow.columnWindow.beforeSize > 0 && (
                    <col style={{ width: matrixWindow.columnWindow.beforeSize }} />
                  )}
                  {visiblePeriods.map((period) => (
                    <col key={period.id} style={{ width: PERIOD_WIDTH }} />
                  ))}
                  {matrixWindow.columnWindow.afterSize > 0 && (
                    <col style={{ width: matrixWindow.columnWindow.afterSize }} />
                  )}
                  <col style={{ width: 88 }} />
                  <col style={{ width: 80 }} />
                </colgroup>
                <thead>
                  <WindowedMonthBandRow
                    header={visibleHeader}
                    leadingLabel={t.schedule.line}
                    leadingColSpan={LEADING_COLUMNS}
                    trailingColSpan={TRAILING_COLUMNS}
                    beforeSize={matrixWindow.columnWindow.beforeSize}
                    afterSize={matrixWindow.columnWindow.afterSize}
                  />
                  <tr className="border-b">
                    <th
                      className="sticky left-0 z-10 bg-card px-2 py-2"
                      style={{ width: 40 }}
                    >
                      {editable && (
                        <Checkbox
                          aria-label={t.schedule.selectAll}
                          checked={selected.size > 0 && selected.size === rows.length}
                          indeterminate={selected.size > 0 && selected.size < rows.length}
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked ? new Set(rows.map((row) => row.leaf.id)) : new Set(),
                            )
                          }
                        />
                      )}
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-left font-medium"
                      style={{ width: 256 }}
                    >
                      {t.schedule.line}
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-medium"
                      style={{ width: 72 }}
                    >
                      {t.schedule.planStart}
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-medium"
                      style={{ width: 72 }}
                    >
                      {t.schedule.planFinish}
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-medium"
                      style={{ width: 96 }}
                    >
                      {t.schedule.planDuration}
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-right font-medium"
                      style={{ width: 112 }}
                    >
                      {t.schedule.planWeightPerPeriod}
                    </th>
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.beforeSize} header />
                    {visibleHeader.columns.map((column, index) => (
                      <th
                        key={column.period.id}
                        scope="col"
                        aria-colindex={LEADING_COLUMNS + matrixWindow.columnWindow.start + index + 1}
                        aria-current={column.isCurrent ? "true" : undefined}
                        className={`w-20 px-2 py-2 text-right font-medium ${
                          column.isCurrent ? "border-b-2 border-b-[var(--chart-3)]" : ""
                        }`}
                      >
                        <span className="block tabular-nums">{column.number}</span>
                        <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                          {column.range}
                        </span>
                      </th>
                    ))}
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.afterSize} header />
                    <th
                      scope="col"
                      aria-colindex={LEADING_COLUMNS + periods.length + 1}
                      className="px-3 py-2 text-right font-medium"
                      style={{ width: 88 }}
                    >
                      {t.schedule.rowTotal}
                    </th>
                    <th
                      scope="col"
                      aria-colindex={LEADING_COLUMNS + periods.length + 2}
                      className="px-2 py-2"
                      style={{ width: 80 }}
                    >
                      <span className="sr-only">{t.common.actions}</span>
                    </th>
                  </tr>
                </thead>

                <tbody>
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
                      <tr
                        key={row.leaf.id}
                        data-matrix-row-index={rowIndex}
                        aria-rowindex={rowIndex + 3}
                        className="border-b last:border-0"
                      >
                        <td className="sticky left-0 z-10 bg-card px-2 py-1">
                          {editable && (
                            <Checkbox
                              aria-label={interpolate(t.schedule.selectRow, { code: row.leaf.code })}
                              checked={selected.has(row.leaf.id)}
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(row.leaf.id);
                                  else next.delete(row.leaf.id);
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>

                        <th
                          scope="row"
                          className="max-w-64 truncate px-2 py-1.5 text-left font-normal"
                          title={`${row.section} - ${row.leaf.description}`}
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.leaf.code}
                          </span>{" "}
                          {row.leaf.description}
                        </th>

                        <PlanInput
                          value={draft.start}
                          label={`${t.schedule.planStart} — ${row.leaf.code}`}
                          min={firstIndex}
                          max={lastIndex}
                          editable={editable}
                          invalid={invertedWindow}
                          describedBy={invertedWindow ? errorId : undefined}
                          onChange={(next) =>
                            setPlanDrafts((current) =>
                              new Map(current).set(row.leaf.id, { ...draft, start: next }),
                            )
                          }
                          onCommit={commit}
                        />
                        <PlanInput
                          value={draft.finish}
                          label={`${t.schedule.planFinish} — ${row.leaf.code}`}
                          min={firstIndex}
                          max={lastIndex}
                          editable={editable}
                          invalid={invertedWindow}
                          describedBy={invertedWindow ? errorId : undefined}
                          onChange={(next) =>
                            setPlanDrafts((current) =>
                              new Map(current).set(row.leaf.id, { ...draft, finish: next }),
                            )
                          }
                          onCommit={commit}
                        />

                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {invertedWindow ? (
                            // The message lives in the cell rather than a
                            // tooltip so it is announced with the field and
                            // survives a keyboard-only pass.
                            <span id={errorId} className="text-xs font-medium text-destructive">
                              {t.schedule.finishBeforeStart}
                            </span>
                          ) : duration > 0 ? (
                            duration
                          ) : (
                            <span className="text-xs">{t.schedule.notScheduled}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                          {rate === null ? "—" : rate.toFixed(3)}
                        </td>

                        <MatrixColumnSpacer size={matrixWindow.columnWindow.beforeSize} />
                        {visibleHeader.columns.map(({ period, accessibleName }, index) => {
                          const value = cells.get(cellKey(row.leaf.id, period.id)) ?? 0;
                          const key = cellKey(row.leaf.id, period.id);
                          return (
                            <td
                              key={period.id}
                              aria-colindex={
                                LEADING_COLUMNS + matrixWindow.columnWindow.start + index + 1
                              }
                              className="px-1 py-1"
                            >
                              {editable ? (
                                <Input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step="any"
                                  value={drafts.get(key) ?? (value === 0 ? "" : String(value))}
                                  aria-label={`${row.leaf.code} - ${accessibleName}`}
                                  className={`h-8 text-right tabular-nums ${
                                    drafts.has(key) ? "border-[var(--chart-3)]" : ""
                                  }`}
                                  onChange={(e) =>
                                    setDrafts((current) => new Map(current).set(key, e.target.value))
                                  }
                                />
                              ) : (
                                <span className="block px-2 py-1 text-right tabular-nums text-muted-foreground">
                                  {value === 0 ? "—" : value}
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <MatrixColumnSpacer size={matrixWindow.columnWindow.afterSize} />

                        <td
                          aria-colindex={LEADING_COLUMNS + periods.length + 1}
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
                        </td>

                        <td
                          aria-colindex={LEADING_COLUMNS + periods.length + 2}
                          className="px-2 py-1"
                        >
                          {editable && (
                            <div className="flex justify-end gap-1">
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`${t.schedule.fillRight} — ${row.leaf.code}`}
                                      onClick={() => fillRight(row.leaf)}
                                    />
                                  }
                                >
                                  <ChevronRight />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                  {t.schedule.fillRightHint}
                                </TooltipContent>
                              </Tooltip>
                              <Button
                                variant={copySource === row.leaf.id ? "secondary" : "ghost"}
                                size="icon-sm"
                                aria-label={`${t.schedule.copyFrom} ${row.leaf.code}`}
                                aria-pressed={copySource === row.leaf.id}
                                onClick={() =>
                                  setCopySource((current) =>
                                    current === row.leaf.id ? null : row.leaf.id,
                                  )
                                }
                              >
                                <Copy />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <MatrixRowSpacer
                    height={matrixWindow.rowWindow.afterSize}
                    colSpan={renderedColumnCount}
                  />
                </tbody>

                <tfoot className="border-t-2">
                  <tr aria-rowindex={rows.length + 3}>
                    <th
                      scope="row"
                      colSpan={LEADING_COLUMNS}
                      className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium"
                    >
                      {t.schedule.plannedPerPeriod}
                    </th>
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.beforeSize} />
                    {planned.perPeriod
                      .slice(matrixWindow.columnWindow.start, matrixWindow.columnWindow.end)
                      .map((value, index) => (
                        <td
                          key={visiblePeriods[index]?.id ?? index}
                          aria-colindex={
                            LEADING_COLUMNS + matrixWindow.columnWindow.start + index + 1
                          }
                          className="px-2 py-2 text-right tabular-nums text-muted-foreground"
                        >
                          {value.toFixed(1)}
                        </td>
                      ))}
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.afterSize} />
                    <td colSpan={TRAILING_COLUMNS} />
                  </tr>
                  <tr aria-rowindex={rows.length + 4}>
                    <th
                      scope="row"
                      colSpan={LEADING_COLUMNS}
                      className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium"
                    >
                      {t.schedule.plannedCumulative}
                    </th>
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.beforeSize} />
                    {planned.cumulative
                      .slice(matrixWindow.columnWindow.start, matrixWindow.columnWindow.end)
                      .map((value, index) => (
                        <td
                          key={visiblePeriods[index]?.id ?? index}
                          aria-colindex={
                            LEADING_COLUMNS + matrixWindow.columnWindow.start + index + 1
                          }
                          className="px-2 py-2 text-right font-medium tabular-nums"
                        >
                          {value.toFixed(1)}
                        </td>
                      ))}
                    <MatrixColumnSpacer size={matrixWindow.columnWindow.afterSize} />
                    <td colSpan={TRAILING_COLUMNS} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
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
function PlanInput({
  value,
  label,
  min,
  max,
  editable,
  invalid,
  describedBy,
  onChange,
  onCommit,
}: {
  value: string;
  label: string;
  min: number;
  max: number;
  editable: boolean;
  invalid: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  if (!editable) {
    return (
      <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{value || "—"}</td>
    );
  }

  return (
    <td className="px-1 py-1">
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="h-8 w-16 text-right tabular-nums"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        // Enter applies without leaving the cell, so a row can be filled from
        // the keyboard without reaching for the mouse between lines.
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          }
        }}
      />
    </td>
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
