"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Badge } from "@DashboardV2/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
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
import { CalendarRange, Save } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { computePlannedCurve, distributionMap, scheduleRows } from "@/lib/boq/curves";
import { trpc } from "@/utils/trpc";

/** A row is "complete" when its cells total 100, within rounding. */
const ROW_TOLERANCE = 0.5;

const cellKey = (itemId: string, periodId: string) => `${itemId}|${periodId}`;

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
  const queryClient = useQueryClient();

  const [drafts, setDrafts] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);

  const reportQuery = useQuery(
    trpc.progress.report.queryOptions({ projectId, versionId: targetVersionId }),
  );
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

  const cells = distributionMap(report?.distribution ?? []);
  for (const [key, value] of drafts) {
    const parsed = value.trim() === "" ? 0 : Number(value);
    if (Number.isFinite(parsed)) cells.set(key, parsed);
  }

  const planned = computePlannedCurve(rows, periods, cells);

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
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.schedule.pathFilter());
      toast.success(t.schedule.saved);
      afterSave?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.schedule.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  const allComplete = rows.every((row) => {
    const total = periods.reduce(
      (sum, period) => sum + (cells.get(cellKey(row.leaf.id, period.id)) ?? 0),
      0,
    );
    return Math.abs(total - 100) <= ROW_TOLERANCE;
  });

  return (
    <div className="space-y-3">
      {settings}
      <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {t.schedule.title}
              <Badge variant={isDraft ? "outline" : "secondary"}>
                {isDraft ? t.boq.draft : t.boq.active}
              </Badge>
            </CardTitle>
            <CardDescription>
              {editable ? t.schedule.description : t.schedule.lockedNote}
            </CardDescription>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {drafts.size > 0 && (
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
              {setupMode && drafts.size === 0 && onReview && (
                <Button size="sm" disabled={!allComplete} onClick={onReview}>
                  {t.baseline.reviewBaseline}
                </Button>
              )}
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
                      title={`${row.section} - ${row.leaf.description}`}
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
                          {editable ? (
                            <Input
                              type="number"
                              min={0}
                              max={100}
                              step="any"
                              value={drafts.get(cellKey(row.leaf.id, period.id)) ?? (value === 0 ? "" : String(value))}
                              aria-label={`${row.leaf.code} - ${period.label ?? period.periodIndex}`}
                              className="h-8 text-right tabular-nums"
                              onChange={(e) =>
                                setDrafts((current) =>
                                  new Map(current).set(cellKey(row.leaf.id, period.id), e.target.value),
                                )
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
        <CardTitle>{t.baseline.timingTitle}</CardTitle>
        <CardDescription>
          {editable ? t.baseline.timingHint : t.baseline.timingLocked}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="baseline-start">{t.projects.startDate}</Label>
          <Input
            id="baseline-start"
            type="date"
            value={startDate}
            disabled={!editable}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baseline-end">{t.projects.endDate}</Label>
          <Input
            id="baseline-end"
            type="date"
            value={endDate}
            disabled={!editable}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="baseline-reporting-start">{t.projects.scheduleStart}</Label>
          <Input
            id="baseline-reporting-start"
            type="date"
            value={scheduleStart}
            disabled={!editable}
            onChange={(event) => setScheduleStart(event.target.value)}
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
