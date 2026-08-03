"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Empty, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@DashboardV2/ui/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil } from "@DashboardV2/ui/components/icons";
import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import ProjectBuildingScene from "@/components/project-building-scene";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

import BaselineTab from "./baseline-tab";
import DailyReportsTab from "./daily-reports-tab";
import NotesTab from "./notes-tab";
import ProjectOverview from "./project-overview";
import ProgressTab from "./progress-tab";
import TeamTab from "./team-tab";
import TicketsTab from "./tickets-tab";
import ProjectFormDialog, {
  projectToFormValues,
  type ProjectFormValues,
} from "../project-form-dialog";

const PROJECT_TABS = ["overview", "tickets", "baseline", "progress", "daily", "notes", "team"] as const;

export default function ProjectDetail({
  projectId,
  canUpdateProject,
  canWrite,
  canManageMembers,
  canReview,
  canLock,
}: {
  projectId: string;
  canUpdateProject: boolean;
  canWrite: boolean;
  canManageMembers: boolean;
  canReview: boolean;
  canLock: boolean;
}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editValues, setEditValues] = useState<ProjectFormValues | null>(null);

  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab &&
    (PROJECT_TABS as readonly string[]).includes(requestedTab) &&
    (requestedTab !== "team" || canManageMembers)
      ? requestedTab
      : "overview";

  function selectTab(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "overview") next.delete("tab");
    else next.set("tab", value);
    if (value !== "tickets") next.delete("action");
    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false });
  }

  const projectQuery = useQuery(trpc.project.get.queryOptions({ id: projectId }));

  const project = projectQuery.data;

  if (projectQuery.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (projectQuery.isError) {
    return (
      <QueryError
        error={projectQuery.error}
        onRetry={() => void projectQuery.refetch()}
      />
    );
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
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.projects.allProjects}
        </Link>
        {canUpdateProject && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditValues(projectToFormValues(project))}
          >
            <Pencil />
            {t.projects.editProject}
          </Button>
        )}
      </div>

      <Card className="h-[120px] overflow-hidden bg-[linear-gradient(112deg,color-mix(in_oklab,var(--card),#f2ebff_42%)_0%,color-mix(in_oklab,var(--card),#eaf7fa_52%)_100%)] py-0">
        <CardContent className="grid h-full grid-cols-[minmax(0,1fr)_minmax(7.5rem,42%)] px-0 sm:grid-cols-[minmax(0,0.85fr)_minmax(16rem,1.15fr)]">
          <div className="relative z-20 flex min-w-0 flex-col justify-center gap-1 px-4 py-3 md:px-6">
            <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
              {project.code}
            </p>
            <div className="flex min-w-0 items-center gap-2">
              <h1
                className="truncate text-lg font-semibold tracking-tight md:text-xl"
                title={project.name}
              >
                {project.name}
              </h1>
              <span className="shrink-0">
                <StatusBadge kind="project" value={project.status} />
              </span>
            </div>
            {(project.client || project.location) && (
              <p className="truncate text-xs text-muted-foreground max-[420px]:hidden">
                {[project.client, project.location].filter(Boolean).join(" - ")}
              </p>
            )}
          </div>
          <ProjectBuildingScene seed={project.code} className="h-full min-h-0" />
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={selectTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList variant="line" className="min-w-max">
            <TabsTrigger value="overview">{t.nav.overview}</TabsTrigger>
            <TabsTrigger value="tickets">{t.projects.tabTickets}</TabsTrigger>
            <TabsTrigger value="baseline">{t.projects.tabBaseline}</TabsTrigger>
            <TabsTrigger value="progress">{t.projects.tabProgress}</TabsTrigger>
            <TabsTrigger value="daily">{t.daily.tab}</TabsTrigger>
            <TabsTrigger value="notes">{t.notes.tab}</TabsTrigger>
            {canManageMembers && <TabsTrigger value="team">{t.projects.teamTab}</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="overview">
          <ProjectOverview project={project} />
        </TabsContent>

        <TabsContent value="baseline">
          <BaselineTab projectId={projectId} canEdit={canWrite} />
        </TabsContent>

        <TabsContent value="progress">
          <ProgressTab
            projectId={projectId}
            canEdit={canWrite}
            canReview={canReview}
            canLock={canLock}
          />
        </TabsContent>

        <TabsContent value="tickets">
          <TicketsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="daily">
          <DailyReportsTab
            projectId={projectId}
            canEdit={canWrite}
            canReview={canReview}
            canLock={canLock}
          />
        </TabsContent>

        <TabsContent value="notes">
          <NotesTab projectId={projectId} canEdit={canWrite} />
        </TabsContent>

        {canManageMembers && (
          <TabsContent value="team">
            <TeamTab projectId={projectId} />
          </TabsContent>
        )}
      </Tabs>

      {canUpdateProject && editValues && (
        <ProjectFormDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditValues(null);
          }}
          editingId={project.id}
          initialValues={editValues}
          progressLocked={project.progressSource === "boq"}
        />
      )}
    </div>
  );
}
