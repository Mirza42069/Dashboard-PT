"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { DeviationBadge } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

/**
 * Projects running behind their BoQ baseline, worst first.
 *
 * Only projects with a baseline and at least one reading can appear — a project
 * with nothing to measure against is absent rather than listed as fine, because
 * "we have no idea" and "on track" are different answers.
 */
export default function BehindSchedule() {
  const t = useT();
  const query = useQuery(trpc.project.behindSchedule.queryOptions({ limit: 5 }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.projects.behindScheduleTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isPending && <Skeleton className="h-24 w-full" />}

        {!query.isPending && (query.data?.length ?? 0) === 0 && (
          <p className="text-muted-foreground">{t.projects.behindScheduleEmpty}</p>
        )}

        {(query.data ?? []).map((row) => (
          <div key={row.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/projects/${row.id}`} className="font-medium hover:underline">
                {row.name}
              </Link>
              <DeviationBadge value={row.deviation} />
            </div>
            <Meter value={row.progress} max={100} />
            <p className="text-xs text-muted-foreground tabular-nums">
              <span className="font-mono">{row.code}</span> · {row.progress.toFixed(1)}%{" "}
              {t.progress.chartActual.toLowerCase()} · {row.planned.toFixed(1)}%{" "}
              {t.progress.chartPlanned.toLowerCase()}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
