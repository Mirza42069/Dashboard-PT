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
import { Input } from "@DashboardV2/ui/components/input";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { DeviationBadge, formatDeviation } from "@/components/deviation-badge";
import { MonthBandRow } from "@/components/month-band-row";
import { statusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
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
import { buildPeriodHeader } from "@/lib/period-header";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import DelayContributors from "./delay-contributors";
import PeriodSummaryTable from "./period-summary-table";
import ReportingWorkflow from "./reporting-workflow";
import SCurveChart from "./s-curve-chart";

/** Ties the chart to the table that carries its figures for assistive tech. */
const SUMMARY_TABLE_ID = "period-summary";

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

  const reportQuery = useQuery(trpc.progress.report.queryOptions({ projectId }));
  const bulkSave = useMutation(trpc.progress.bulkSave.mutationOptions());

  if (reportQuery.isPending) return <Skeleton className="h-64 w-full" />;

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

  const rows = scheduleRows(items);
  const entries = report?.entries ?? [];
  const cells = distributionMap(report?.distribution ?? []);
  const planned = computePlannedCurve(rows, periods, cells);
  const actual = computeActualCurve(rows, periods, entries, dataDate);
  const position = latestPosition(actual.cumulative, planned.cumulative);

  // The chart and the table below it are built from this one call, so the line
  // someone is looking at and the figure they are about to quote cannot
  // disagree.
  const summary = buildPeriodSummary(rows, periods, cells, entries, dataDate);
  const header = buildPeriodHeader(format, periods, dataDate);
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

  async function save() {
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
      toast.success(t.progress.saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.progress.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const hasReadings = position.index >= 0;

  return (
    <div className="space-y-3">
      <ReportingWorkflow
        projectId={projectId}
        canEdit={canEdit}
        canReview={canReview}
        canLock={canLock}
        selectedPeriodId={selectedPeriodId}
        onSelectPeriod={setSelectedPeriodId}
      />

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
                  hasReadings && position.deviation < -0.05 ? "text-destructive" : ""
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
            <CardTitle>{t.periodSummary.title}</CardTitle>
            <CardDescription>{t.periodSummary.description}</CardDescription>
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
        />
      )}

      {periods.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t.progress.matrixTitle}</CardTitle>
                <CardDescription>{t.progress.matrixHint}</CardDescription>
              </div>
              {canEdit && drafts.size > 0 && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDrafts(new Map())}>
                    {t.progress.discard}
                  </Button>
                  <Button size="sm" disabled={saving} onClick={() => void save()}>
                    <Save />
                    {saving
                      ? t.progress.saving
                      : interpolate(t.progress.save, { count: drafts.size })}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="px-0">
            <div className="relative">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-card to-transparent"
              />
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <MonthBandRow header={header} leadingLabel={t.schedule.line} />
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium">
                      <span className="sr-only">{t.schedule.line}</span>
                    </th>
                    {header.columns.map((column) => (
                      <th
                        key={column.period.id}
                        scope="col"
                        aria-current={column.isCurrent ? "true" : undefined}
                        className={`min-w-24 px-2 py-2 text-right font-medium ${
                          column.isCurrent ? "border-b-2 border-b-[var(--chart-3)]" : ""
                        }`}
                      >
                        <span className="block tabular-nums">{column.number}</span>
                        <span className="block text-xs font-normal text-muted-foreground tabular-nums">
                          {column.range}
                        </span>
                        {column.isCurrent && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t.periodSummary.current}
                          </span>
                        )}
                        {!isEditable(column.period.status) && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {statusLabel(t, "period", column.period.status)}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((row) => (
                    <tr key={row.leaf.id} className="border-b last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 max-w-64 truncate bg-card px-4 py-1.5 text-left font-normal"
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

                      {header.columns.map(({ period, accessibleName }) => {
                        const key = cellKey(row.leaf.id, period.id);
                        // The workflow decides, not a status string compared in
                        // place — a submitted report is frozen for the reviewer
                        // just as firmly as a locked one is.
                        const editable = canEdit && isEditable(period.status);

                        return (
                          <td key={period.id} className="px-1 py-1">
                            {editable ? (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={cellValue(row.leaf.id, period.id)}
                                aria-label={`${row.leaf.code} - ${accessibleName}`}
                                className={`h-8 text-right tabular-nums ${
                                  drafts.has(key) ? "border-[var(--chart-3)]" : ""
                                }`}
                                onChange={(e) =>
                                  setDrafts((current) =>
                                    new Map(current).set(key, e.target.value),
                                  )
                                }
                              />
                            ) : (
                              <span className="block px-2 py-1 text-right tabular-nums text-muted-foreground">
                                {cellValue(row.leaf.id, period.id) || "—"}
                              </span>
                            )}
                            {/*
                             * An explicit "nothing moved here" is not the same
                             * as an empty cell, and the grid has to say so — it
                             * is the difference between a report that can be
                             * submitted and one that cannot.
                             */}
                            {entryByKey.get(key)?.noProgress && (
                              <span className="mt-0.5 block text-center text-[10px] text-muted-foreground">
                                {t.reporting.noProgressShort}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
