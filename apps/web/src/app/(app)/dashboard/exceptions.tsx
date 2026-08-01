"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { DeviationBadge, formatDeviation } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * The dashboard, organised around what is wrong rather than what exists.
 *
 * A count of active projects tells a manager nothing they can act on. Four
 * things do: which jobs are behind, which reports are overdue, which are
 * waiting on *them*, and which sites have gone quiet. Each card is a number, a
 * denominator so the number means something, and a link into the filtered list
 * behind it — a tile that cannot be clicked through to the records it counts is
 * a decoration.
 *
 * "Stale" and "behind" are deliberately separate cards. A project reporting
 * on time and 5% behind is a schedule problem; a project that has said nothing
 * for a month might be fine, or might be a disaster nobody has measured yet.
 * Merging them would hide the second inside the first.
 */

/** Matches STALE_AFTER_DAYS in the API — the age at which silence is a finding. */
const STALE_AFTER_DAYS = 14;

export default function Exceptions() {
  const t = useT();
  const { formatDate } = useFormat();
  const query = useQuery(trpc.project.exceptions.queryOptions({ limit: 10 }));

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  }

  const { counts, projects } = query.data;

  const cards = [
    {
      key: "behind",
      label: t.exceptions.behind,
      value: counts.behind,
      denominator: interpolate(t.exceptions.behindOf, { total: counts.live }),
      max: counts.live,
      href: { pathname: "/projects", query: { status: "active" } } as const,
    },
    {
      key: "reportsDue",
      label: t.exceptions.reportsDue,
      value: counts.reportsDue,
      denominator: t.exceptions.reportsDueHint,
      max: Math.max(counts.reportsDue, counts.live),
      href: { pathname: "/projects" } as const,
    },
    {
      key: "awaitingReview",
      label: t.exceptions.awaitingReview,
      value: counts.awaitingReview,
      denominator: t.exceptions.awaitingReviewHint,
      max: Math.max(counts.awaitingReview, counts.live),
      href: { pathname: "/projects" } as const,
    },
    {
      key: "stale",
      label: t.exceptions.stale,
      value: counts.stale,
      denominator: t.exceptions.staleHint,
      max: counts.live,
      href: { pathname: "/projects" } as const,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.key} size="sm">
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p
                className={`text-2xl font-semibold tabular-nums ${
                  card.value > 0 ? "text-destructive" : ""
                }`}
              >
                {card.value}
              </p>
              {/*
               * The meter gives the count a shape against its denominator —
               * "3" means something different out of 4 projects than out of 40.
               * Not decorative: remove it and the number loses its scale.
               */}
              <Meter value={card.value} max={Math.max(card.max, 1)} segments={8} />
              <p className="text-xs text-muted-foreground">{card.denominator}</p>
              <Link
                href={card.href}
                className="inline-block text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t.nav.projects}
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.exceptions.title}</CardTitle>
          <CardDescription>{t.exceptions.description}</CardDescription>
        </CardHeader>

        <CardContent className="px-0">
          {projects.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{t.exceptions.empty}</EmptyTitle>
                <EmptyDescription>{t.exceptions.emptyHint}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      {t.exceptions.project}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.exceptions.planned}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.exceptions.actual}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.exceptions.variance}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.exceptions.change}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t.exceptions.dataDate}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t.exceptions.issues}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {projects.map((row) => {
                    // Change since the previous *reported* period, not since a
                    // fixed number of days ago — see previousDataDate in
                    // boq-metrics. Null where there is nothing to compare with.
                    const change =
                      row.deviation === null || row.previousDeviation === null
                        ? null
                        : row.deviation - row.previousDeviation;
                    const isStale =
                      row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS;

                    return (
                      <tr key={row.projectId} className="border-b last:border-0">
                        <th scope="row" className="px-4 py-2 text-left font-normal">
                          <Link
                            href={`/projects/${row.projectId}`}
                            className="font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            aria-label={interpolate(t.exceptions.viewProject, { name: row.name })}
                          >
                            {row.name}
                          </Link>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {row.code}
                          </span>
                        </th>

                        <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                          {row.dataDate === null ? "—" : row.planned.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {row.dataDate === null ? "—" : row.progress.toFixed(1)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <DeviationBadge value={row.deviation} className="justify-end" />
                        </td>

                        <td
                          className={`px-2 py-2 text-right tabular-nums ${
                            change !== null && change < -0.05 ? "text-destructive" : ""
                          }`}
                        >
                          {change === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <>
                              {formatDeviation(change)}
                              <span className="sr-only"> {t.exceptions.sinceLast}</span>
                            </>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {row.dataDate === null ? (
                            <span className="text-muted-foreground">
                              {t.exceptions.noReadings}
                            </span>
                          ) : (
                            <>
                              <span className={isStale ? "font-medium text-destructive" : ""}>
                                {formatDate(row.dataDate)}
                              </span>
                              {row.reportAgeDays !== null && (
                                <span className="block text-muted-foreground">
                                  {interpolate(t.exceptions.daysAgo, {
                                    count: row.reportAgeDays,
                                  })}
                                  {/* Written, not only coloured. */}
                                  {isStale ? ` · ${t.exceptions.stale}` : ""}
                                </span>
                              )}
                            </>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {row.openTickets > 0 ? (
                            <Link
                              href={`/projects/${row.projectId}`}
                              className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              {row.openTickets}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
