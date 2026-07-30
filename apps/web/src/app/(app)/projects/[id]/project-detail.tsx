"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@DashboardV2/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "@DashboardV2/ui/components/icons";
import Link from "next/link";

import { DeviationBadge } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { StatusBadge } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import BaselineTab from "./baseline-tab";
import NotesTab from "./notes-tab";
import ProgressTab from "./progress-tab";
import TeamTab from "./team-tab";
import TicketsTab from "./tickets-tab";

export default function ProjectDetail({
  projectId,
  canEdit,
  canManageMembers,
}: {
  projectId: string;
  canEdit: boolean;
  canManageMembers: boolean;
}) {
  const t = useT();
  const { money, percent, formatDate } = useFormat();

  const projectQuery = useQuery(trpc.project.get.queryOptions({ id: projectId }));

  const project = projectQuery.data;

  if (projectQuery.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!project) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t.projects.notFound}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.projects.allProjects}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{project.name}</h1>
            <StatusBadge kind="project" value={project.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{project.code}</span>
            {project.client && ` - ${project.client}`}
            {project.location && ` - ${project.location}`}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.contractValueTile}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {project.contractValue === null ? "—" : money(project.contractValue)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.workCompleted}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold tabular-nums">
              {project.workCompletedValue === null ? "—" : money(project.workCompletedValue)}
            </p>
            {project.workCompletedValue !== null && project.contractValue !== null && (
              <Meter
                value={project.workCompletedValue}
                max={project.contractValue}
                label={percent(project.valueCompletionPercent)}
              />
            )}
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.remainingContractValue}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold tabular-nums">
              {project.remainingContractValue === null
                ? "—"
                : money(project.remainingContractValue)}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t.projects.siteProgress}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xl font-semibold tabular-nums">
              {project.progressPercent.toFixed(project.progressSource === "boq" ? 1 : 0)}%
            </p>
            <Meter value={project.progressPercent} max={100} />
            {/* With a baseline the figure is measured; without one there is no
                physical-progress source to report. */}
            {project.progressSource === "boq" ? (
              <div className="space-y-0.5">
                <DeviationBadge value={project.deviation} className="text-xs" />
                <p className="text-xs text-muted-foreground">
                  {project.dataDate
                    ? interpolate(t.projects.asOf, { date: formatDate(project.dataDate) })
                    : t.projects.progressFromBoq}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t.projects.noBaselineYet}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Detail label={t.projects.startDate} value={formatDate(project.startDate)} />
        <Detail label={t.projects.targetCompletion} value={formatDate(project.endDate)} />
        <Detail label={t.projects.manager} value={project.manager?.name ?? t.common.unassigned} />
      </div>

      <Tabs defaultValue="tickets">
        <TabsList>
          <TabsTrigger value="tickets">{t.projects.tabTickets}</TabsTrigger>
          <TabsTrigger value="baseline">{t.projects.tabBaseline}</TabsTrigger>
          <TabsTrigger value="progress">{t.projects.tabProgress}</TabsTrigger>
          <TabsTrigger value="notes">{t.notes.tab}</TabsTrigger>
          {canManageMembers && <TabsTrigger value="team">{t.projects.teamTab}</TabsTrigger>}
        </TabsList>

        <TabsContent value="baseline">
          <BaselineTab projectId={projectId} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="progress">
          <ProgressTab projectId={projectId} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="tickets">
          <TicketsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="notes">
          <NotesTab projectId={projectId} canEdit={canEdit} />
        </TabsContent>

        {canManageMembers && (
          <TabsContent value="team">
            <TeamTab projectId={projectId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}
