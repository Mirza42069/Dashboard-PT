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
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
import { Input } from "@DashboardV2/ui/components/input";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ChevronDown,
  Download,
  Loader2,
  Plus,
  Trash2,
} from "@DashboardV2/ui/components/icons";
import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { QueryError } from "@/components/query-error";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { TableEmptyState } from "@/components/table-empty-state";
import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useLocale, useT } from "@/i18n/provider";
import { downloadFromServer } from "@/lib/download-file";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

import { EMPTY_PROJECT, PROJECT_STATUSES } from "./project-form-values";

const ProjectFormDialog = dynamic(() => import("./project-form-dialog"));
const ProjectCreateSourceDialog = dynamic(() => import("./project-create-source-dialog"));
const ProjectWorkbookImportDialog = dynamic(() => import("./project-workbook-import-dialog"));

const PAGE_SIZE = 25;
const ALL = "all";
type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export default function ProjectsTable({
  canCreate,
  canDelete,
  canManageMembers,
  currentUserId,
  trialAiCredits,
}: {
  canCreate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  currentUserId: string;
  /** AI imports this trial has left; null on an account with no trial. */
  trialAiCredits: number | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const router = useRouter();
  const statusOptions = [
    { value: ALL, label: t.common.all },
    ...PROJECT_STATUSES.map((value) => ({ value, label: statusLabel("project", value) })),
  ];

  const [search, setSearch] = useState("");
  const searchParams = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const status =
    requestedStatus && (PROJECT_STATUSES as readonly string[]).includes(requestedStatus)
      ? requestedStatus
      : ALL;
  const [formOpen, setFormOpen] = useState(false);
  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [workbookOpen, setWorkbookOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounced(search);

  const COLUMNS = 5;

  // What the empty state needs to know: is this list empty because nothing
  // exists, or because the filters hid it?
  const filtered = debouncedSearch !== "" || status !== ALL;

  function clearFilters() {
    setSearch("");
    selectStatus(ALL);
  }

  const projectsQuery = useInfiniteQuery(
    trpc.project.list.infiniteQueryOptions(
      {
        search: debouncedSearch,
        status: status === ALL ? undefined : (status as ProjectStatus),
        limit: PAGE_SIZE,
      },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );

  const deleteMany = useMutation(trpc.project.deleteMany.mutationOptions());
  const setArchived = useMutation(trpc.project.setArchived.mutationOptions());

  const projects = projectsQuery.data?.pages.flatMap((page) => page.projects) ?? [];
  const total = projectsQuery.data?.pages[0]?.total ?? 0;
  const initialError = projectsQuery.isError && projectsQuery.data === undefined;

  const selection = useRowSelection(projects, {
    getId: (row) => row.id,
    resetKey: `${debouncedSearch}\u0000${status}`,
  });

  function replaceProjectParams(nextStatus: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextStatus === ALL) params.delete("status");
    else params.set("status", nextStatus);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/projects?${query}` : "/projects");
  }

  function selectStatus(nextStatus: string) {
    if (nextStatus === status) return;
    replaceProjectParams(nextStatus);
  }

  /**
   * File the selection away.
   *
   * Deliberately not behind a confirmation: archiving takes nothing away and
   * the Archive page restores it in one click, so a modal here would be a
   * prompt about something reversible. Deletion, which is not, keeps its.
   */
  async function archiveSelected() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    try {
      const result = await setArchived.mutateAsync({ ids, archived: true });
      selection.clear();
      await Promise.all([
        queryClient.invalidateQueries(trpc.project.pathFilter()),
        queryClient.invalidateQueries(trpc.activity.pathFilter()),
      ]);
      toast.success(plural(t.projects.archivedToast, result.count));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.archiveFailed);
    }
  }

  function openCreate() {
    setCreateSourceOpen(true);
  }

  async function downloadSpreadsheet() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    if (ids.length > 100) {
      toast.error(t.projects.bulkExportLimit);
      return;
    }
    setExporting(true);
    try {
      await downloadFromServer(
        "/projects/export",
        ids.length === 1 ? "project.xlsx" : "projects.zip",
        t.projects.exportFailed,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectIds: ids, locale }),
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
    if (ids.length > 100) {
      setBulkDeleteOpen(false);
      toast.error(t.projects.bulkDeleteLimit);
      return;
    }
    try {
      // force, for the same reason as the single-row path: the dialog already
      // spells out that tickets go too.
      await deleteMany.mutateAsync({ ids, force: true });
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(plural(t.projects.bulkDeletedToast, ids.length));
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.deleteFailed);
    }
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {projectsQuery.isPending ? t.common.loading : ""}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {exporting ? t.projects.exporting : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
          placeholder={t.projects.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        {selection.selectedCount > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={plural(t.projects.exportSelectedLabel, selection.selectedCount)}
                  aria-busy={exporting}
                  disabled={exporting}
                  onClick={() => void downloadSpreadsheet()}
                />
              }
            >
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {plural(t.projects.exportSelectedLabel, selection.selectedCount)}
            </TooltipContent>
          </Tooltip>
        )}

        {canDelete && selection.selectedCount > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={plural(t.projects.archiveSelectedLabel, selection.selectedCount)}
                  onClick={() => {
                    if (selection.selectedCount > 100) {
                      toast.error(t.projects.bulkDeleteLimit);
                      return;
                    }
                    void archiveSelected();
                  }}
                />
              }
            >
              <Archive />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {plural(t.projects.archiveSelectedLabel, selection.selectedCount)}
            </TooltipContent>
          </Tooltip>
        )}

        {canDelete && selection.selectedCount > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label={plural(t.projects.deleteSelectedLabel, selection.selectedCount)}
                  onClick={() => {
                    if (selection.selectedCount > 100) {
                      toast.error(t.projects.bulkDeleteLimit);
                      return;
                    }
                    setBulkDeleteOpen(true);
                  }}
                />
              }
            >
              <Trash2 />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {plural(t.projects.deleteSelectedLabel, selection.selectedCount)}
            </TooltipContent>
          </Tooltip>
        )}

        {canCreate && (
          <Button size="sm" className="ml-auto" onClick={openCreate}>
            <Plus />
            {t.projects.newProject}
          </Button>
        )}
      </div>

      <Card aria-busy={projectsQuery.isPending || projectsQuery.isFetchingNextPage}>
        <CardContent className="px-0">
          <Table className="min-w-[44rem] table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={selection.allSelected}
                  indeterminate={selection.someSelected}
                  onCheckedChange={selection.toggleAll}
                  aria-label={t.common.selectAll}
                />
              </TableHead>
              <TableHead className="w-[40%]">
                {t.projects.project}
              </TableHead>
              <TableHead className="w-40">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="xs" className="-ml-2" />}
                    aria-label={interpolate(t.projects.statusFilterLabel, {
                      status:
                        statusOptions.find((option) => option.value === status)?.label ??
                        t.common.all,
                    })}
                  >
                    {t.projects.statusLabel}
                    <ChevronDown />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48 bg-card">
                    <DropdownMenuRadioGroup value={status} onValueChange={selectStatus}>
                      {statusOptions.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value}>
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
              <TableHead className="w-[25%]">{t.projects.client}</TableHead>
              <TableHead className="w-32 pr-4">{t.projects.dueColumn}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectsQuery.isPending &&
              Array.from({ length: PAGE_SIZE }, (_, index) => (
                <TableRow key={index}>
                  <TableCell colSpan={COLUMNS} className="pl-4">
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))}

            {initialError && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="p-4">
                  <QueryError
                    error={projectsQuery.error}
                    onRetry={() => void projectsQuery.refetch()}
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            )}

            {!projectsQuery.isPending && !initialError && projects.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS} className="p-0">
                  <TableEmptyState
                    filtered={filtered}
                    onClearFilters={clearFilters}
                    title={filtered ? t.projects.noMatch : t.projects.empty}
                    description={filtered ? t.projects.noMatchHint : t.projects.emptyHint}
                  />
                </TableCell>
              </TableRow>
            )}

            {projects.map((row) => (
              <TableRow
                key={row.id}
                className="relative cursor-pointer"
                data-state={selection.isSelected(row.id) ? "selected" : undefined}
              >
                <TableCell className="relative z-10 pl-4">
                  <Checkbox
                    checked={selection.isSelected(row.id)}
                    onCheckedChange={() => selection.toggle(row.id)}
                    aria-label={interpolate(t.common.selectRow, { name: row.name })}
                  />
                </TableCell>
                <TableCell className="min-w-0">
                  <Link
                    href={`/projects/${row.id}`}
                    className="block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                  >
                    {row.name}
                  </Link>
                  <p className="truncate font-mono text-muted-foreground">{row.code}</p>
                </TableCell>
                <TableCell>
                  <StatusBadge kind="project" value={row.status} />
                </TableCell>
                <TableCell className="truncate text-muted-foreground">
                  {row.client ?? "—"}
                </TableCell>
                <TableCell className="pr-4 whitespace-nowrap text-muted-foreground">
                  {formatDate(row.endDate)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!initialError && (
        <InfiniteLoadMore
          hasNextPage={projectsQuery.hasNextPage}
          isFetchingNextPage={projectsQuery.isFetchingNextPage}
          isFetchNextPageError={projectsQuery.isFetchNextPageError}
          loadedCount={projects.length}
          total={total}
          onLoadMore={() => void projectsQuery.fetchNextPage()}
        />
      )}

      {canCreate && formOpen && (
        <ProjectFormDialog
          // No `key` on purpose: the dialog resets itself from initialValues, so
          // remounting it would only throw away the mounted form to build an
          // identical one.
          open={formOpen}
          onOpenChange={setFormOpen}
          editingId={null}
          initialValues={EMPTY_PROJECT}
          canManageMembers={canManageMembers}
          currentUserId={currentUserId}
          onCreated={(projectId) =>
            router.push(`/projects/${projectId}?tab=baseline&step=boq` as Route)
          }
        />
      )}

      {canCreate && createSourceOpen && (
        <ProjectCreateSourceDialog
          open={createSourceOpen}
          onOpenChange={setCreateSourceOpen}
          onManual={() => {
            setCreateSourceOpen(false);
            setFormOpen(true);
          }}
          onExcel={() => {
            setCreateSourceOpen(false);
            setWorkbookOpen(true);
          }}
        />
      )}

      {canCreate && workbookOpen && (
        <ProjectWorkbookImportDialog
          open={workbookOpen}
          onOpenChange={setWorkbookOpen}
          currentUserId={currentUserId}
          trialAiCredits={trialAiCredits}
          onCreated={(projectId) => {
            void queryClient.invalidateQueries(trpc.project.pathFilter());
            router.push(`/projects/${projectId}?tab=baseline&step=boq` as Route);
          }}
        />
      )}

      {canDelete && (
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {plural(t.common.bulkDeleteTitle, selection.selectedCount)}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <span className="block">{t.projects.bulkDeleteDescription}</span>
                <span className="block font-medium text-foreground">
                  {summarizeSelection(
                    projects
                      .filter((row) => selection.isSelected(row.id))
                      .map((row) => `${row.code} - ${row.name}`),
                    t,
                  )}
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  setBulkDeleteOpen(false);
                  void confirmBulkDelete();
                }}
              >
                {t.common.delete}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
