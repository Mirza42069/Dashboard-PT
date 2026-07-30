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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "@DashboardV2/ui/components/icons";
import Link from "next/link";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { DeviationBadge } from "@/components/deviation-badge";
import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { TableEmptyState } from "@/components/table-empty-state";
import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

import ProjectFormDialog, { EMPTY_PROJECT, type ProjectFormValues } from "./project-form-dialog";

const PAGE_SIZE = 25;
const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
const ALL = "all";


export default function ProjectsTable({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { money, percent, formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const statusOptions = [
    { value: ALL, label: t.common.all },
    ...STATUSES.map((value) => ({ value, label: statusLabel("project", value) })),
  ];

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<ProjectFormValues>(EMPTY_PROJECT);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const debouncedSearch = useDebounced(search);

  // Counted once, from the same `canManage` that decides whether the columns
  // render. It was written out by hand at each of the three full-width rows
  // below as `canManage ? 9 : 8` — but a manager sees ten columns, not nine, so
  // the skeleton, error and empty rows all stopped one short and left a stray
  // cell at the end of the row.
  const COLUMNS = canManage ? 10 : 8;

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
    setEditingId(null);
    setInitialValues(EMPTY_PROJECT);
    setFormOpen(true);
  }

  function openEdit(row: (typeof projects)[number]) {
    setEditingId(row.id);
    setInitialValues({
      code: row.code,
      name: row.name,
      client: row.client ?? "",
      location: row.location ?? "",
      status: row.status,
      managerId: row.managerId ?? "",
      notes: row.notes ?? "",
    });
    setFormOpen(true);
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
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={openCreate}>
            <Plus />
            {t.projects.newProject}
          </Button>
        )}
      </div>

      {canManage && (
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
                {canManage && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected}
                      onCheckedChange={selection.toggleAll}
                      aria-label={t.common.selectAll}
                    />
                  </TableHead>
                )}
                <TableHead className={canManage ? undefined : "pl-4"}>{t.projects.project}</TableHead>
                <TableHead>{t.projects.statusLabel}</TableHead>
                <TableHead>{t.projects.client}</TableHead>
                <TableHead className="w-56">{t.projects.workCompleted}</TableHead>
                <TableHead className="w-44">{t.projects.siteProgress}</TableHead>
                <TableHead className="text-right">{t.projects.contract}</TableHead>
                <TableHead>{t.projects.dueColumn}</TableHead>
                <TableHead className="text-right">{t.projects.openTicketsColumn}</TableHead>
                {canManage && <TableHead className="pr-4 text-right">{t.common.actions}</TableHead>}
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
                      onCreate={canManage ? openCreate : undefined}
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
                  data-state={selection.isSelected(row.id) ? "selected" : undefined}
                >
                  {canManage && (
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selection.isSelected(row.id)}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={interpolate(t.common.selectRow, { name: row.name })}
                      />
                    </TableCell>
                  )}
                  <TableCell className={canManage ? undefined : "pl-4"}>
                    <Link href={`/projects/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    <p className="font-mono text-muted-foreground">{row.code}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="project" value={row.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.client ?? "—"}</TableCell>
                  <TableCell>
                    {row.workCompletedValue === null || row.contractValue === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <Meter
                          value={row.workCompletedValue}
                          max={row.contractValue}
                        />
                        <p className="mt-1 text-muted-foreground">
                          {money(row.workCompletedValue)} - {percent(row.valueCompletionPercent)}
                        </p>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Meter value={row.progressPercent} max={100} />
                    <p className="mt-1 text-muted-foreground">
                      {row.progressPercent.toFixed(row.progressSource === "boq" ? 1 : 0)}%
                      {row.progressSource === "boq" ? (
                        <span className="ml-1.5">
                          <DeviationBadge value={row.deviation} />
                        </span>
                      ) : (
                        <span className="ml-1.5">{t.projects.progressManual}</span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.contractValue === null ? "—" : money(row.contractValue)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.endDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.openTickets}</TableCell>
                  {canManage && (
                    <TableCell className="pr-4 text-right">
                      {/* Edit is the only per-row action left; deleting happens
                          through the selection checkboxes. */}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={interpolate(t.projects.editLabel, { name: row.name })}
                        onClick={() => openEdit(row)}
                      >
                        <Pencil />
                      </Button>
                    </TableCell>
                  )}
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

      {canManage && (
        <ProjectFormDialog
          // Remount on target change so the form picks up fresh defaultValues.
          key={editingId ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          editingId={editingId}
          initialValues={initialValues}
        />
      )}

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
    </>
  );
}
