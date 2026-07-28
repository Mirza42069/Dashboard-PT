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
import { CalendarRange } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { computePlannedCurve, distributionMap, scheduleRows } from "@/lib/boq/curves";
import { trpc } from "@/utils/trpc";

/** A row is "complete" when its cells total 100, within rounding. */
const ROW_TOLERANCE = 0.5;

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

export default function ScheduleTab({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();

  /** Cells the user has typed but the server has not confirmed yet. */
  const [pending, setPending] = useState<Map<string, number>>(new Map());

  const reportQuery = useQuery(trpc.progress.report.queryOptions({ projectId }));
  const generatePeriods = useMutation(trpc.schedule.generatePeriods.mutationOptions());
  const setCells = useMutation(trpc.schedule.setDistributionCells.mutationOptions());

  if (reportQuery.isPending) return <Skeleton className="h-64 w-full" />;

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
  const isDraft = version.status === "draft";
  const canEdit = isAdmin && isDraft;

  if (periods.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.schedule.noPeriods}</EmptyTitle>
              <EmptyDescription>{t.schedule.noPeriodsHint}</EmptyDescription>
            </EmptyHeader>
            {isAdmin && (
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
    );
  }

  const rows = scheduleRows(items);

  // Server values overlaid with anything still in flight, so a cell keeps the
  // number the user typed even while its request is on the wire.
  const cells = distributionMap(report?.distribution ?? []);
  for (const [key, value] of pending) cells.set(key, value);

  const planned = computePlannedCurve(rows, periods, cells);

  async function commit(itemId: string, periodId: string, raw: string) {
    const key = cellKey(itemId, periodId);
    const parsed = raw.trim() === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return;

    setPending((current) => new Map(current).set(key, parsed));

    try {
      await setCells.mutateAsync({
        versionId,
        cells: [{ boqItemId: itemId, periodId, plannedPct: parsed }],
      });
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.schedule.pathFilter());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
    } finally {
      // Drop the optimistic value either way: on success the refetch supplies
      // it, on failure the server's number is the honest one to show.
      setPending((current) => {
        const next = new Map(current);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.schedule.title}</CardTitle>
        <CardDescription>
          {canEdit ? t.schedule.description : t.schedule.lockedNote}
        </CardDescription>
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
                  <th key={period.id} className="min-w-20 px-2 py-2 text-right font-medium">
                    {period.label ?? `#${period.periodIndex}`}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">{t.schedule.rowTotal}</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const rowTotal = periods.reduce(
                  (total, period) => total + (cells.get(cellKey(row.leaf.id, period.id)) ?? 0),
                  0,
                );
                const isComplete = Math.abs(rowTotal - 100) <= ROW_TOLERANCE;

                return (
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
                    </th>

                    {periods.map((period) => {
                      const value = cells.get(cellKey(row.leaf.id, period.id)) ?? 0;
                      return (
                        <td key={period.id} className="px-1 py-1">
                          {canEdit ? (
                            <Input
                              // Uncontrolled so typing stays local, but keyed on
                              // the value so a rejected save snaps the cell back
                              // to what the server actually holds.
                              key={`${row.leaf.id}-${period.id}-${value}`}
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              defaultValue={value === 0 ? "" : String(value)}
                              aria-label={`${row.leaf.code} · ${period.label ?? period.periodIndex}`}
                              className="h-8 text-right tabular-nums"
                              onBlur={(e) => void commit(row.leaf.id, period.id, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                            />
                          ) : (
                            <span className="block px-2 py-1 text-right tabular-nums text-muted-foreground">
                              {value === 0 ? "—" : value}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td
                      className={`px-3 py-1 text-right tabular-nums ${
                        isComplete ? "text-muted-foreground" : "font-medium text-destructive"
                      }`}
                      title={
                        isComplete
                          ? undefined
                          : interpolate(t.schedule.rowIncomplete, {
                              total: `${rowTotal.toFixed(1)}%`,
                            })
                      }
                    >
                      {rowTotal.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot className="border-t-2">
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium"
                >
                  {t.schedule.plannedPerPeriod}
                </th>
                {planned.perPeriod.map((value, index) => (
                  <td
                    key={periods[index]?.id ?? index}
                    className="px-2 py-2 text-right tabular-nums text-muted-foreground"
                  >
                    {value.toFixed(1)}
                  </td>
                ))}
                <td />
              </tr>
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium"
                >
                  {t.schedule.plannedCumulative}
                </th>
                {planned.cumulative.map((value, index) => (
                  <td
                    key={periods[index]?.id ?? index}
                    className="px-2 py-2 text-right font-medium tabular-nums"
                  >
                    {value.toFixed(1)}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
