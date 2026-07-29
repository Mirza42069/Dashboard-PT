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
import { Save } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { DeviationBadge, formatDeviation } from "@/components/deviation-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import {
  computeActualCurve,
  computePlannedCurve,
  distributionMap,
  latestPosition,
  scheduleRows,
} from "@/lib/boq/curves";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import SCurveChart from "./s-curve-chart";

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

export default function ProgressTab({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const t = useT();
  const { formatDate } = useFormat();
  const queryClient = useQueryClient();

  /**
   * Edits are batched rather than saved per cell. Entering a period's readings
   * means touching many lines at once, and one "Save" is both fewer round trips
   * and a clearer undo point than a dozen silent writes.
   */
  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);

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
  const planned = computePlannedCurve(rows, periods, distributionMap(report?.distribution ?? []));
  const actual = computeActualCurve(rows, periods, entries, dataDate);
  const position = latestPosition(actual.cumulative, planned.cumulative);

  const chartData = periods.map((period, index) => ({
    label: period.label ?? `#${period.periodIndex}`,
    planned: planned.cumulative[index] ?? 0,
    actual: actual.cumulative[index] ?? null,
  }));

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
              <SCurveChart data={chartData} />
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t.progress.matrixTitle}</CardTitle>
                <CardDescription>{t.progress.matrixHint}</CardDescription>
              </div>
              {isAdmin && drafts.size > 0 && (
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium">
                      {t.schedule.line}
                    </th>
                    {periods.map((period) => (
                      <th key={period.id} className="min-w-24 px-2 py-2 text-right font-medium">
                        {period.label ?? `#${period.periodIndex}`}
                        {period.status === "locked" && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t.progress.locked}
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
                        title={`${row.section} · ${row.leaf.description}`}
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

                      {periods.map((period) => {
                        const key = cellKey(row.leaf.id, period.id);
                        const editable = isAdmin && period.status !== "locked";

                        return (
                          <td key={period.id} className="px-1 py-1">
                            {editable ? (
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={cellValue(row.leaf.id, period.id)}
                                aria-label={`${row.leaf.code} · ${period.label ?? period.periodIndex}`}
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
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
