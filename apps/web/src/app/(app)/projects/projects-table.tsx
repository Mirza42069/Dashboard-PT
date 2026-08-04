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
import { Input } from "@DashboardV2/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Plus, Trash2 } from "@DashboardV2/ui/components/icons";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { QueryError } from "@/components/query-error";
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

import ProjectFormDialog, { EMPTY_PROJECT } from "./project-form-dialog";

const PAGE_SIZE = 25;
const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
const ALL = "all";


export default function ProjectsTable({
  canCreate,
  canDelete,
  canManageMembers,
  currentUserId,
}: {
  canCreate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  currentUserId: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const router = useRouter();
  const statusOptions = [
    { value: ALL, label: t.common.all },
    ...STATUSES.map((value) => ({ value, label: statusLabel("project", value) })),
  ];

  const [search, setSearch] = useState("");
  /**
   * Seeded from the URL so a dashboard card can link straight to "the projects
   * this number counted". Read once as the initial value rather than kept in
   * sync — after landing, the dropdown owns the filter, and a URL that fought
   * the control would make clearing the filter impossible.
   */
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<string>(() => {
    const requested = searchParams.get("status");
    return requested && (STATUSES as readonly string[]).includes(requested) ? requested : ALL;
  });
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const debouncedSearch = useDebounced(search);

  const COLUMNS = canDelete ? 5 : 4;

  // What the empty state needs to know: is this list empty because nothing
  // exists, or because the filters hid it?
  const filtered = debouncedSearch !== "" || status !== ALL;

  function clearFilters() {
    setSearch("");
    setStatus(ALL);
    setPage(0);
  }

  const projectsQuery = useQuery(
    trpc.project.list.queryOptions({
      search: debouncedSearch,
      status: status === ALL ? undefined : (status as (typeof STATUSES)[number]),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );

  const deleteMany = useMutation(trpc.project.deleteMany.mutationOptions());

  const projects = projectsQuery.data?.projects ?? [];
  const total = projectsQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  const selection = useRowSelection(projects);

  function openCreate() {
    setFormOpen(true);
  }

  async function downloadSpreadsheet() {
    setExporting(true);
    try {
      await downloadFromServer(
        `/projects/export?locale=${locale}`,
        "projects.xlsx",
        t.projects.exportFailed,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.exportFailed);
    } finally {
      setExporting(false);
    }
  }

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={t.projects.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <Select
          items={statusOptions}
          value={status}
          onValueChange={(value) => {
            setStatus(value ?? ALL);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40" aria-label={t.projects.statusLabel}>
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t.projects.exportLabel}
                disabled={exporting}
                onClick={() => void downloadSpreadsheet()}
              />
            }
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.projects.exportLabel}</TooltipContent>
        </Tooltip>

        {canCreate && (
          <Button size="sm" className="ml-auto" onClick={openCreate}>
            <Plus />
            {t.projects.newProject}
          </Button>
        )}
      </div>

      {canDelete && (
        <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
          <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 />
            {t.common.deleteSelected}
          </Button>
        </BulkActionsBar>
      )}

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                {canDelete && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected}
                      onCheckedChange={selection.toggleAll}
                      aria-label={t.common.selectAll}
                    />
                  </TableHead>
                )}
                <TableHead className={canDelete ? undefined : "pl-4"}>{t.projects.project}</TableHead>
                <TableHead>{t.projects.statusLabel}</TableHead>
                <TableHead>{t.projects.client}</TableHead>
                <TableHead className="pr-4">{t.projects.dueColumn}</TableHead>
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

              {projectsQuery.isError && (
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

              {!projectsQuery.isPending && !projectsQuery.isError && projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="p-0">
                    <TableEmptyState
                      filtered={filtered}
                      onClearFilters={clearFilters}
                      onCreate={canCreate ? openCreate : undefined}
                      createLabel={t.projects.newProject}
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
                  {canDelete && (
                    <TableCell className="relative z-10 pl-4">
                      <Checkbox
                        checked={selection.isSelected(row.id)}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={interpolate(t.common.selectRow, { name: row.name })}
                      />
                    </TableCell>
                  )}
                  <TableCell className={canDelete ? undefined : "pl-4"}>
                    <Link
                      href={`/projects/${row.id}`}
                      className="font-medium outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                    >
                      {row.name}
                    </Link>
                    <p className="font-mono text-muted-foreground">{row.code}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="project" value={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.client ?? "—"}</TableCell>
                  <TableCell className="pr-4 whitespace-nowrap text-muted-foreground">
                    {formatDate(row.endDate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? t.projects.noProjects
            : interpolate(t.projects.showing, {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + projects.length,
                total,
              })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            {t.common.previous}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage}
            onClick={() => setPage((value) => value + 1)}
          >
            {t.common.next}
          </Button>
        </div>
      </div>

      {canCreate && (
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
            router.push(`/projects/${projectId}?tab=baseline` as Route)
          }
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
