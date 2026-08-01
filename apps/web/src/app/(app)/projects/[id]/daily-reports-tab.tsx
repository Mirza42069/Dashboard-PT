"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { DatePicker } from "@DashboardV2/ui/components/date-picker";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Plus } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useLocale, useT } from "@/i18n/provider";
import { datePickerLabels } from "@/lib/date-picker-labels";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import DailyReportForm from "./daily-report-form";

/**
 * The daily report register, and the way into one report.
 *
 * A register first rather than a form first: on any site that has been running
 * a while the common task is "find Tuesday's report", not "write a new one".
 * Opening today's is one button away regardless.
 *
 * The whole tab is a two-state view — list or one report — rather than a route
 * per report, because the project page is already a tab set and pushing a
 * nested route under it would put two competing navigations on one screen.
 */

const ALL = "__all__";
const PAGE_SIZE = 30;

/** Today as "YYYY-MM-DD" in the viewer's own calendar, which is the day they mean. */
function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function DailyReportsTab({
  projectId,
  canEdit,
  canReview,
  canLock,
}: {
  projectId: string;
  canEdit: boolean;
  canReview: boolean;
  canLock: boolean;
}) {
  const t = useT();
  const { intlLocale } = useLocale();
  const { formatDate } = useFormat();
  const queryClient = useQueryClient();

  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [openDate, setOpenDate] = useState(today());

  const listQuery = useQuery(
    trpc.dailyReport.list.queryOptions({
      projectId,
      status:
        status === ALL
          ? undefined
          : (status as "draft" | "submitted" | "reviewed" | "approved" | "returned"),
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );
  const open = useMutation(trpc.dailyReport.open.mutationOptions());

  if (openId) {
    return (
      <DailyReportForm
        reportId={openId}
        canEdit={canEdit}
        canReview={canReview}
        canLock={canLock}
        onBack={() => setOpenId(null)}
      />
    );
  }

  const data = listQuery.data;
  const reports = data?.reports ?? [];
  const total = data?.total ?? 0;
  const filtered = status !== ALL || from !== "" || to !== "";

  const statusOptions = [
    { value: ALL, label: t.common.all },
    { value: "draft", label: t.status.dailyReport.draft },
    { value: "submitted", label: t.status.dailyReport.submitted },
    { value: "reviewed", label: t.status.dailyReport.reviewed },
    { value: "approved", label: t.status.dailyReport.approved },
    { value: "returned", label: t.status.dailyReport.returned },
  ];

  const weatherLabel: Record<string, string> = {
    clear: t.daily.weatherClear,
    cloudy: t.daily.weatherCloudy,
    light_rain: t.daily.weatherLightRain,
    heavy_rain: t.daily.weatherHeavyRain,
    storm: t.daily.weatherStorm,
    extreme_heat: t.daily.weatherExtremeHeat,
  };

  async function openReport(date: string) {
    try {
      const result = await open.mutateAsync({ projectId, reportDate: date });
      await queryClient.invalidateQueries(trpc.dailyReport.pathFilter());
      setOpenId(result.id);
      if (result.created) toast.success(t.daily.openedToday);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t.daily.title}</CardTitle>
            <CardDescription>{t.daily.description}</CardDescription>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="daily-open-date" className="text-xs text-muted-foreground">
                  {t.daily.openDate}
                </Label>
                <DatePicker
                  id="daily-open-date"
                  value={openDate || null}
                  locale={intlLocale}
                  formatValue={formatDate}
                  labels={datePickerLabels(t)}
                  onValueChange={(next) => setOpenDate(next ?? "")}
                />
              </div>
              <Button
                disabled={open.isPending || !openDate}
                onClick={() => void openReport(openDate)}
              >
                <Plus />
                {t.daily.newReport}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="daily-status" className="text-xs text-muted-foreground">
              {t.daily.filterStatus}
            </Label>
            <Select
              items={statusOptions}
              value={status}
              onValueChange={(value) => {
                setStatus(value ?? ALL);
                setPage(0);
              }}
            >
              <SelectTrigger id="daily-status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="daily-from" className="text-xs text-muted-foreground">
              {t.daily.filterFrom}
            </Label>
            <DatePicker
              id="daily-from"
              value={from || null}
              locale={intlLocale}
              formatValue={formatDate}
              labels={datePickerLabels(t)}
              onValueChange={(next) => {
                setFrom(next ?? "");
                setPage(0);
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="daily-to" className="text-xs text-muted-foreground">
              {t.daily.filterTo}
            </Label>
            <DatePicker
              id="daily-to"
              value={to || null}
              min={from || null}
              locale={intlLocale}
              formatValue={formatDate}
              labels={datePickerLabels(t)}
              onValueChange={(next) => {
                setTo(next ?? "");
                setPage(0);
              }}
            />
          </div>

          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus(ALL);
                setFrom("");
                setTo("");
                setPage(0);
              }}
            >
              {t.common.clearFilters}
            </Button>
          )}
        </div>

        {listQuery.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : reports.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{filtered ? t.daily.noMatch : t.daily.empty}</EmptyTitle>
              {!filtered && <EmptyDescription>{t.daily.emptyHint}</EmptyDescription>}
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t.daily.date}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t.common.actions}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t.daily.weather}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t.daily.manpower}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t.daily.photos}
                    </th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">
                      {t.daily.preparedBy}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((row) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <button
                          type="button"
                          className="font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          onClick={() => setOpenId(row.id)}
                        >
                          {formatDate(row.reportDate)}
                        </button>
                        {row.status === "returned" && row.returnReason && (
                          <span className="block max-w-72 truncate text-xs text-destructive">
                            {row.returnReason}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-2">
                        <StatusBadge kind="dailyReport" value={row.status} />
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.weather ? (weatherLabel[row.weather] ?? row.weather) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.headcount > 0 ? row.headcount : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {row.photoCount > 0 ? row.photoCount : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.preparedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {interpolate(t.daily.showing, {
                    from: page * PAGE_SIZE + 1,
                    to: Math.min((page + 1) * PAGE_SIZE, total),
                    total,
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    {t.common.previous}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(page + 1) * PAGE_SIZE >= total}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t.common.next}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
