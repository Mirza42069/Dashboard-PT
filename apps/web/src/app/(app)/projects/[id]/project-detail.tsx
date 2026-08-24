"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Alert, AlertAction, AlertDescription } from "@DashboardV2/ui/components/alert";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Empty, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@DashboardV2/ui/components/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AiFile, Archive, ArrowLeft, Pencil } from "@DashboardV2/ui/components/icons";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import ProjectBuildingScene from "@/components/project-building-scene";
import { StatusBadge } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import ProjectOverview from "./project-overview";
import { projectToFormValues, type ProjectFormValues } from "../project-form-values";

/**
 * `boq` and `schedule` are the two steps of the baseline flow, surfaced as
 * their own tab values so each has a URL. They render the same component as
 * `baseline` — the stepper inside it reads the tab instead of local state —
 * which keeps their order and their gating while making them linkable.
 */
const PROJECT_TABS = [
  "overview",
  "tickets",
  "baseline",
  "boq",
  "schedule",
  "progress",
  "daily",
  "notes",
  "team",
] as const;

/** Which step of the baseline flow a tab value means. */
const BASELINE_STEP_TABS = { boq: "boq", schedule: "schedule", baseline: "review" } as const;

const tabLoading = () => <Skeleton className="h-64 w-full" />;
const BaselineTab = dynamic(() => import("./baseline-tab"), { loading: tabLoading });
const DailyReportsTab = dynamic(() => import("./daily-reports-tab"), { loading: tabLoading });
const NotesTab = dynamic(() => import("./notes-tab"), { loading: tabLoading });
const ProgressTab = dynamic(() => import("./progress-tab"), { loading: tabLoading });
const TeamTab = dynamic(() => import("./team-tab"), { loading: tabLoading });
const TicketsTab = dynamic(() => import("./tickets-tab"), { loading: tabLoading });
const ProjectFormDialog = dynamic(() => import("../project-form-dialog"));
const ProjectWorkbookUpdateDialog = dynamic(() => import("./project-workbook-update-dialog"));

export default function ProjectDetail({
  projectId,
  currentUserId,
  canArchive,
  canUpdateProject,
  canWrite,
  canManageMembers,
  canReview,
  canLock,
}: {
  projectId: string;
  currentUserId: string;
  canArchive: boolean;
  canUpdateProject: boolean;
  canWrite: boolean;
  canManageMembers: boolean;
  canReview: boolean;
  canLock: boolean;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [editValues, setEditValues] = useState<ProjectFormValues | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [dailyDirty, setDailyDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab &&
    (PROJECT_TABS as readonly string[]).includes(requestedTab) &&
    (requestedTab !== "team" || canManageMembers)
      ? requestedTab
      : "overview";

  function applyTab(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "overview") next.delete("tab");
    else next.set("tab", value);
    if (value !== "tickets") next.delete("action");
    const query = next.toString();
    router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false });
  }

  function selectTab(value: string) {
    if (activeTab === "daily" && value !== "daily" && dailyDirty) {
      setPendingTab(value);
      return;
    }
    applyTab(value);
  }

  const queryClient = useQueryClient();
  const projectQuery = useQuery(trpc.project.get.queryOptions({ id: projectId }));
  const setArchived = useMutation(trpc.project.setArchived.mutationOptions());

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

  /**
   * An archived project is readable but frozen.
   *
   * The four capability flags below are what every tab is already handed, so
   * clearing them here is what makes all nine read-only at once. This is the
   * courtesy half — the procedures refuse the write either way (see
   * assertProjectWritable in packages/api/src/lib/scope.ts). Doing both means
   * nobody is offered a control that would only fail.
   */
  const archived = project.archivedAt !== null;
  const writable = canWrite && !archived;

  async function restore() {
    try {
      await setArchived.mutateAsync({ ids: [projectId], archived: false });
      await Promise.all([
        queryClient.invalidateQueries(trpc.project.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
      ]);
      toast.success(plural(t.projects.restoredToast, 1));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.archiveFailed);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.projects.allProjects}
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canUpdateProject && writable && (
            <Button variant="outline" size="sm" onClick={() => setUpdateOpen(true)}>
              <AiFile />
              {t.projectUpdate.trigger}
            </Button>
          )}
          {canUpdateProject && !archived && (
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
          </div>
          <ProjectBuildingScene seed={project.code} className="h-full min-h-0" />
        </CardContent>
      </Card>

      {archived && (
        <Alert>
          <Archive />
          <AlertDescription>
            {interpolate(t.projects.archivedBanner, {
              date: formatDateTime(project.archivedAt),
            })}
          </AlertDescription>
          {canArchive && (
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                disabled={setArchived.isPending}
                onClick={() => void restore()}
              >
                {t.projects.restore}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}

      <Tabs value={activeTab} onValueChange={selectTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList variant="line" className="min-w-max">
            <TabsTrigger value="overview">{t.nav.overview}</TabsTrigger>
            <TabsTrigger value="tickets">{t.projects.tabTickets}</TabsTrigger>
            <TabsTrigger value="boq">{t.projects.tabBoq}</TabsTrigger>
            <TabsTrigger value="schedule">{t.projects.tabSchedule}</TabsTrigger>
            <TabsTrigger value="baseline">{t.projects.tabBaseline}</TabsTrigger>
            <TabsTrigger value="progress">{t.projects.tabProgress}</TabsTrigger>
            <TabsTrigger value="daily">{t.daily.tab}</TabsTrigger>
            <TabsTrigger value="notes">{t.notes.tab}</TabsTrigger>
            {canManageMembers && <TabsTrigger value="team">{t.projects.teamTab}</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="overview">
          {activeTab === "overview" && <ProjectOverview project={project} />}
        </TabsContent>

        {(["boq", "schedule", "baseline"] as const).map((value) => (
          <TabsContent key={value} value={value}>
            {activeTab === value && (
              <BaselineTab
                projectId={projectId}
                canEdit={writable}
                step={BASELINE_STEP_TABS[value]}
                onStepChange={(next) =>
                  selectTab(next === "review" ? "baseline" : next)
                }
              />
            )}
          </TabsContent>
        ))}

        <TabsContent value="progress">
          {activeTab === "progress" && (
            <ProgressTab
              projectId={projectId}
              canEdit={writable}
              canReview={canReview && !archived}
              canLock={canLock && !archived}
            />
          )}
        </TabsContent>

        <TabsContent value="tickets">
          {activeTab === "tickets" && <TicketsTab projectId={projectId} canEdit={writable} />}
        </TabsContent>

        <TabsContent value="daily">
          {activeTab === "daily" && (
            <DailyReportsTab
              projectId={projectId}
              canEdit={writable}
              canReview={canReview && !archived}
              canLock={canLock && !archived}
              onDirtyChange={setDailyDirty}
            />
          )}
        </TabsContent>

        <TabsContent value="notes">
          {activeTab === "notes" && <NotesTab projectId={projectId} canEdit={writable} />}
        </TabsContent>

        {canManageMembers && (
          <TabsContent value="team">
            {activeTab === "team" && (
              <TeamTab projectId={projectId} managerId={project.managerId} canEdit={!archived} />
            )}
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
          canManageMembers={canManageMembers}
          currentUserId={currentUserId}
        />
      )}

      {canUpdateProject && writable && updateOpen && (
        <ProjectWorkbookUpdateDialog
          open
          projectId={projectId}
          currentUserId={currentUserId}
          onOpenChange={setUpdateOpen}
          onUpdated={(result) => {
            if (result.draftVersionId) selectTab("boq");
            else if (result.sectionsUpdated.length === 1 && result.sectionsUpdated[0] === "progress") {
              selectTab("progress");
            }
          }}
        />
      )}

      <AlertDialog open={pendingTab !== null} onOpenChange={(open) => !open && setPendingTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.daily.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.daily.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.keepEditing}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingTab) return;
                const nextTab = pendingTab;
                setDailyDirty(false);
                setPendingTab(null);
                applyTab(nextTab);
              }}
            >
              {t.common.discardChanges}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
