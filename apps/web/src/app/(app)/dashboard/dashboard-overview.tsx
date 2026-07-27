"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Hammer, ListChecks, TrendingUp, Wallet } from "lucide-react";

import { Meter } from "@/components/meter";
import { StatusBadge } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import ActivityFeed from "./activity-feed";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

export default function DashboardOverview() {
  const t = useT();
  const { money, moneyCompact, percent } = useFormat();
  const summary = useQuery(trpc.project.summary.queryOptions());

  if (summary.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const data = summary.data;
  if (!data) return null;

  const totalProjects = data.projects.total;

  const stats = [
    {
      icon: Hammer,
      label: t.dashboard.activeProjects,
      value: String(data.projects.byStatus.active),
      hint: interpolate(t.dashboard.totalProjects, { count: totalProjects }),
    },
    {
      icon: TrendingUp,
      label: t.dashboard.portfolioValue,
      value: moneyCompact(data.portfolioValue),
      hint: t.dashboard.portfolioHint,
    },
    {
      icon: Wallet,
      label: t.dashboard.spentOfBudget,
      value: percent(data.budgetUsedPercent),
      hint: `${money(data.spent)} / ${money(data.budget)}`,
    },
    {
      icon: ListChecks,
      label: t.dashboard.openTasks,
      value: String(data.openTasks),
      hint: t.dashboard.openTasksHint,
    },
  ];

  return (
    <div className="space-y-4">
      {/* One bar rather than four cards: these are peers read together, and a
          single surface with dividers reads as one summary instead of four
          competing objects. */}
      <Card>
        {/* Dividers only at xl, where all four sit in one row and DOM order
            matches visual order. Below that the grid wraps, and divide-x would
            draw lines in the wrong places — so it falls back to plain spacing. */}
        <CardContent className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:gap-0 xl:divide-x">
          {stats.map(({ icon: Icon, label, value, hint }) => (
            <div key={label} className="space-y-1 xl:px-5 xl:first:pl-0 xl:last:pr-0">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="size-3.5" />
                {label}
              </p>
              <p className="text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.dashboard.byStatus}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {totalProjects === 0 && <p className="text-muted-foreground">{t.dashboard.noProjects}</p>}
            {totalProjects > 0 &&
              PROJECT_STATUSES.map((status) => {
                const count = data.projects.byStatus[status];
                return (
                  <div key={status} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <StatusBadge kind="project" value={status} />
                      <span className="tabular-nums text-muted-foreground">
                        {count} · {percent(totalProjects > 0 ? (count / totalProjects) * 100 : 0)}
                      </span>
                    </div>
                    <Meter value={count} max={totalProjects} />
                  </div>
                );
              })}
          </CardContent>
        </Card>

        <ActivityFeed />
      </div>
    </div>
  );
}
