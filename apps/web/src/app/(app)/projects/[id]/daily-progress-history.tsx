"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import { Button } from "@DashboardV2/ui/components/button";
import { Input } from "@DashboardV2/ui/components/input";
import { Upload } from "@DashboardV2/ui/components/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

function percentage(value: number | null, digits = 2) {
  return value === null ? "-" : `${value.toFixed(digits)}%`;
}

type DailyItem = NonNullable<ReturnType<typeof useDailyDetail>>["items"][number];

function useDailyDetail(projectId: string, snapshotId: string) {
  return useQuery({
    ...trpc.dailyProgress.detail.queryOptions({
      projectId,
      snapshotId: snapshotId || "pending",
    }),
    enabled: Boolean(snapshotId),
  }).data;
}

function total(items: DailyItem[], field: keyof DailyItem) {
  return items.reduce((sum, item) => {
    const value = item[field];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
}

function groupItems(items: DailyItem[]) {
  const groups = new Map<
    string,
    {
      code: string | null;
      description: string;
      parents: Map<string, { code: string | null; description: string | null; items: DailyItem[] }>;
    }
  >();
  for (const item of items) {
    const sectionKey = `${item.sectionCode ?? ""}\0${item.sectionDescription ?? ""}`;
    const section = groups.get(sectionKey) ?? {
      code: item.sectionCode,
      description: item.sectionDescription ?? "",
      parents: new Map(),
    };
    const parentKey = `${item.parentCode ?? ""}\0${item.parentDescription ?? ""}`;
    const parent = section.parents.get(parentKey) ?? {
      code: item.parentCode,
      description: item.parentDescription,
      items: [],
    };
    parent.items.push(item);
    section.parents.set(parentKey, parent);
    groups.set(sectionKey, section);
  }
  return [...groups.values()];
}

export default function DailyProgressHistory({
  projectId,
  canImport,
  onImportProgress,
}: {
  projectId: string;
  canImport: boolean;
  onImportProgress: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const listQuery = useQuery(trpc.dailyProgress.list.queryOptions({ projectId }));
  const snapshots = listQuery.data ?? [];
  const effectiveId = selectedId || snapshots.at(-1)?.id || "";
  const detailQuery = useQuery({
    ...trpc.dailyProgress.detail.queryOptions({ projectId, snapshotId: effectiveId || "pending" }),
    enabled: Boolean(effectiveId),
  });

  if (listQuery.isPending) return <Skeleton className="h-72 w-full" />;
  if (listQuery.isError) {
    return <QueryError error={listQuery.error} onRetry={() => void listQuery.refetch()} />;
  }
  if (snapshots.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.progress.dailyTitle}</CardTitle>
          <CardDescription>{t.progress.dailyEmpty}</CardDescription>
        </CardHeader>
        {canImport && (
          <CardContent>
            <Button type="button" onClick={onImportProgress}>
              <Upload />
              {t.progress.importProgress}
            </Button>
          </CardContent>
        )}
      </Card>
    );
  }

  const selected = snapshots.find((snapshot) => snapshot.id === effectiveId) ?? snapshots.at(-1)!;
  const allItems = detailQuery.data?.items ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const items = allItems.filter(
    (item) =>
      !normalizedSearch ||
      `${item.sectionCode ?? ""} ${item.sectionDescription ?? ""} ${item.parentCode ?? ""} ${item.parentDescription ?? ""} ${item.code ?? ""} ${item.description}`
        .toLocaleLowerCase()
        .includes(normalizedSearch),
  );
  const groups = groupItems(items);
  const aggregate = {
    amount: total(allItems, "amount"),
    weight: total(allItems, "weight"),
    previousWeighted: total(allItems, "previousWeighted"),
    currentWeighted: total(allItems, "currentWeighted"),
    cumulativeWeighted: total(allItems, "cumulativeWeighted"),
    remainingWeighted: total(allItems, "remainingWeighted"),
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-[linear-gradient(120deg,color-mix(in_oklab,var(--card),var(--chart-4)_8%),var(--card))]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <CardTitle>{t.progress.dailyTitle}</CardTitle>
            <CardDescription>{t.progress.dailyDescription}</CardDescription>
          </div>
          <div className="text-end">
            <p className="text-3xl font-semibold tracking-tight tabular-nums">
              {selected.cumulativePercent.toFixed(2)}%
            </p>
            <p className="text-xs text-muted-foreground">{format.formatDate(selected.reportDate)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(12rem,18rem)_minmax(12rem,1fr)]">
          <div className="space-y-1.5">
            <label htmlFor="daily-progress-date" className="text-sm font-medium">
              {t.progress.dailyDate}
            </label>
            <Select
              items={snapshots.map((snapshot) => ({
                value: snapshot.id,
                label: `${format.formatDate(snapshot.reportDate)} · ${snapshot.cumulativePercent.toFixed(2)}%`,
              }))}
              value={effectiveId}
              onValueChange={(value) => setSelectedId(value ?? "")}
            >
              <SelectTrigger id="daily-progress-date" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {snapshots.map((snapshot) => (
                  <SelectItem key={snapshot.id} value={snapshot.id}>
                    {format.formatDate(snapshot.reportDate)} · {snapshot.cumulativePercent.toFixed(2)}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="daily-progress-search" className="text-sm font-medium">
              {t.progress.dailySearch}
            </label>
            <Input
              id="daily-progress-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.progress.dailySearchPlaceholder}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            [t.progress.dailyPrevious, aggregate.previousWeighted, "bg-[color-mix(in_oklab,var(--chart-5),transparent_88%)]"],
            [t.progress.dailyCurrent, aggregate.currentWeighted, "bg-[color-mix(in_oklab,var(--chart-4),transparent_88%)]"],
            [t.progress.dailyCumulative, aggregate.cumulativeWeighted, "bg-[color-mix(in_oklab,var(--chart-2),transparent_88%)]"],
            [t.progress.dailyRemaining, aggregate.remainingWeighted, "bg-[color-mix(in_oklab,var(--destructive),transparent_91%)]"],
          ].map(([label, value, className]) => (
            <div key={String(label)} className={`rounded-lg p-3 ${className}`}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{Number(value).toFixed(2)}%</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {selected.sourceFilename} · {selected.sourceSheetName} · {interpolate(t.progress.dailyItemCount, { count: allItems.length })}
        </p>

        {detailQuery.isError ? (
          <QueryError error={detailQuery.error} onRetry={() => void detailQuery.refetch()} />
        ) : detailQuery.isPending ? (
          <Skeleton className="h-80 w-full" />
        ) : (
          <div
            className="max-h-[42rem] overflow-auto rounded-lg border"
            role="region"
            aria-label={t.progress.dailyTableLabel}
            tabIndex={0}
          >
            <table className="min-w-[1420px] w-full border-collapse text-xs">
              <thead className="sticky top-0 z-20 bg-card text-center">
                <tr className="border-b bg-muted/70">
                  <th rowSpan={2} scope="col" className="w-20 px-2 py-2 text-start">{t.progress.dailyCode}</th>
                  <th rowSpan={2} scope="col" className="min-w-72 px-2 py-2 text-start">{t.progress.dailyDescriptionLabel}</th>
                  <th rowSpan={2} scope="col" className="px-2 py-2 text-end">{t.progress.dailyQuantity}</th>
                  <th rowSpan={2} scope="col" className="px-2 py-2">{t.progress.dailyUnit}</th>
                  <th rowSpan={2} scope="col" className="px-2 py-2 text-end">{t.progress.dailyUnitRate}</th>
                  <th rowSpan={2} scope="col" className="px-2 py-2 text-end">{t.progress.dailyAmount}</th>
                  <th rowSpan={2} scope="col" className="px-2 py-2 text-end">{t.progress.dailyWeight}</th>
                  <th colSpan={2} scope="colgroup" className="bg-[color-mix(in_oklab,var(--chart-5),transparent_85%)] px-2 py-2">{t.progress.dailyPrevious}</th>
                  <th colSpan={2} scope="colgroup" className="bg-[color-mix(in_oklab,var(--chart-4),transparent_85%)] px-2 py-2">{t.progress.dailyCurrent}</th>
                  <th colSpan={2} scope="colgroup" className="bg-[color-mix(in_oklab,var(--chart-2),transparent_85%)] px-2 py-2">{t.progress.dailyCumulative}</th>
                  <th colSpan={2} scope="colgroup" className="bg-[color-mix(in_oklab,var(--destructive),transparent_90%)] px-2 py-2">{t.progress.dailyRemaining}</th>
                  <th rowSpan={2} scope="col" className="min-w-44 px-2 py-2 text-start">{t.progress.dailyRemarks}</th>
                </tr>
                <tr className="border-b text-[11px] text-muted-foreground">
                  {Array.from({ length: 4 }, (_, index) => (
                    <FragmentPair key={index} percent={t.progress.dailyPercent} weighted={t.progress.dailyWeighted} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((section) => {
                  const sectionItems = [...section.parents.values()].flatMap((parent) => parent.items);
                  return (
                    <SectionRows
                      key={`${section.code}-${section.description}`}
                      section={section}
                      items={sectionItems}
                      format={format}
                      labels={t.progress}
                    />
                  );
                })}
                {items.length > 0 && (
                  <TotalRow
                    label={t.progress.dailyGrandTotal}
                    items={items}
                    format={format}
                    strong
                  />
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FragmentPair({ percent, weighted }: { percent: string; weighted: string }) {
  return (
    <>
      <th scope="col" className="px-2 py-1.5 text-end">{percent}</th>
      <th scope="col" className="px-2 py-1.5 text-end">{weighted}</th>
    </>
  );
}

function SectionRows({ section, items, format, labels }: {
  section: ReturnType<typeof groupItems>[number];
  items: DailyItem[];
  format: ReturnType<typeof useFormat>;
  labels: ReturnType<typeof useT>["progress"];
}) {
  return (
    <>
      <tr className="border-y bg-[color-mix(in_oklab,var(--chart-1),transparent_88%)]">
        <th colSpan={16} scope="rowgroup" className="px-3 py-2 text-start font-semibold tracking-wide">
          {section.code && <span className="me-3 font-mono text-muted-foreground">{section.code}</span>}
          {section.description || labels.dailyDescriptionLabel}
        </th>
      </tr>
      {[...section.parents.values()].map((parent) => (
        <FragmentParent key={`${parent.code}-${parent.description}`} parent={parent} format={format} />
      ))}
      <TotalRow label={`${labels.dailySubtotal} ${section.description}`} items={items} format={format} />
    </>
  );
}

function FragmentParent({ parent, format }: {
  parent: ReturnType<typeof groupItems>[number]["parents"] extends Map<string, infer T> ? T : never;
  format: ReturnType<typeof useFormat>;
}) {
  return (
    <>
      {parent.description && (
        <tr className="border-b bg-muted/35">
          <th scope="rowgroup" className="px-2 py-1.5 text-start font-mono text-muted-foreground">{parent.code}</th>
          <th colSpan={15} scope="rowgroup" className="px-2 py-1.5 text-start font-medium">{parent.description}</th>
        </tr>
      )}
      {parent.items.map((item) => (
        <tr key={item.id} className="border-b align-top hover:bg-muted/25">
          <td className="whitespace-nowrap px-2 py-1.5 font-mono text-muted-foreground">{item.code || "-"}</td>
          <th scope="row" className="px-2 py-1.5 text-start font-normal">{item.description}</th>
          <td className="px-2 py-1.5 text-end tabular-nums">{item.quantity === null ? "-" : format.quantity(item.quantity)}</td>
          <td className="px-2 py-1.5 text-center">{item.unit || "-"}</td>
          <td className="px-2 py-1.5 text-end tabular-nums">{item.unitRate === null ? "-" : format.money(item.unitRate)}</td>
          <td className="px-2 py-1.5 text-end tabular-nums">{item.amount === null ? "-" : format.money(item.amount)}</td>
          <td className="px-2 py-1.5 text-end tabular-nums">{percentage(item.weight, 3)}</td>
          <ProgressPair percent={item.previousPercent} weighted={item.previousWeighted} tone="previous" />
          <ProgressPair percent={item.currentPercent} weighted={item.currentWeighted} tone="current" />
          <ProgressPair percent={item.cumulativePercent} weighted={item.cumulativeWeighted} tone="cumulative" />
          <ProgressPair percent={item.remainingPercent} weighted={item.remainingWeighted} tone="remaining" />
          <td className="px-2 py-1.5">{item.remark || "-"}</td>
        </tr>
      ))}
    </>
  );
}

function ProgressPair({ percent, weighted, tone }: {
  percent: number | null;
  weighted: number | null;
  tone: "previous" | "current" | "cumulative" | "remaining";
}) {
  const tones = {
    previous: "bg-[color-mix(in_oklab,var(--chart-5),transparent_92%)]",
    current: "bg-[color-mix(in_oklab,var(--chart-4),transparent_92%)]",
    cumulative: "bg-[color-mix(in_oklab,var(--chart-2),transparent_92%)]",
    remaining: "bg-[color-mix(in_oklab,var(--destructive),transparent_95%)]",
  };
  return (
    <>
      <td className={`${tones[tone]} px-2 py-1.5 text-end tabular-nums`}>{percentage(percent)}</td>
      <td className={`${tones[tone]} px-2 py-1.5 text-end tabular-nums`}>{weighted === null ? "-" : weighted.toFixed(2)}</td>
    </>
  );
}

function TotalRow({ label, items, format, strong = false }: {
  label: string;
  items: DailyItem[];
  format: ReturnType<typeof useFormat>;
  strong?: boolean;
}) {
  return (
    <tr className={`border-y ${strong ? "bg-foreground text-background" : "bg-muted/65"}`}>
      <th colSpan={5} scope="row" className="px-2 py-2 text-end font-semibold uppercase tracking-wide">{label}</th>
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{format.money(total(items, "amount"))}</td>
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{total(items, "weight").toFixed(2)}%</td>
      <td />
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{total(items, "previousWeighted").toFixed(2)}</td>
      <td />
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{total(items, "currentWeighted").toFixed(2)}</td>
      <td />
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{total(items, "cumulativeWeighted").toFixed(2)}</td>
      <td />
      <td className="px-2 py-2 text-end font-semibold tabular-nums">{total(items, "remainingWeighted").toFixed(2)}</td>
      <td />
    </tr>
  );
}
