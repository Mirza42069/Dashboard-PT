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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
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
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Meter } from "@/components/meter";
import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import ProjectFormDialog, { EMPTY_PROJECT, type ProjectFormValues } from "./project-form-dialog";

const PAGE_SIZE = 25;
const STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;
const ALL = "all";

type PendingDelete = { id: string; code: string; name: string };

export default function ProjectsTable({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const { money, percent, formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialValues, setInitialValues] = useState<ProjectFormValues>(EMPTY_PROJECT);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const projectsQuery = useQuery(
    trpc.project.list.queryOptions({
      search,
      status: status === ALL ? undefined : (status as (typeof STATUSES)[number]),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );

  const deleteProject = useMutation(trpc.project.delete.mutationOptions());

  const projects = projectsQuery.data?.projects ?? [];
  const total = projectsQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

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
      startDate: row.startDate ?? "",
      endDate: row.endDate ?? "",
      contractValue: row.contractValue,
      budget: row.budget,
      progress: row.progress,
      managerId: row.managerId ?? "",
      notes: row.notes ?? "",
    });
    setFormOpen(true);
  }

  async function confirmDelete(target: PendingDelete) {
    try {
      await deleteProject.mutateAsync({ id: target.id, force: true });
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(interpolate(t.projects.deleted, { code: target.code }));
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
            <SelectItem value={ALL}>{t.common.all}</SelectItem>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {statusLabel("project", value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && (
          <Button size="sm" className="ml-auto" onClick={openCreate}>
            <Plus />
            {t.projects.newProject}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.projects.project}</TableHead>
                <TableHead>{t.projects.statusLabel}</TableHead>
                <TableHead>{t.projects.client}</TableHead>
                <TableHead className="w-56">{t.projects.budgetUsed}</TableHead>
                <TableHead className="text-right">{t.projects.contract}</TableHead>
                <TableHead>{t.projects.dueColumn}</TableHead>
                <TableHead className="text-right">{t.projects.openTasksColumn}</TableHead>
                {isAdmin && <TableHead className="pr-4 text-right">{t.common.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectsQuery.isPending &&
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={isAdmin ? 8 : 7} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!projectsQuery.isPending && projects.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 8 : 7}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {search || status !== ALL ? t.projects.noMatch : t.projects.empty}
                  </TableCell>
                </TableRow>
              )}

              {projects.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4">
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
                    <Meter value={row.spent} max={row.budget} />
                    <p className="mt-1 text-muted-foreground">
                      {money(row.spent)}
                      {row.budget > 0 && ` · ${percent(row.budgetUsedPercent)}`}
                      {row.isOverBudget && (
                        <span className="ml-1 font-medium text-destructive">
                          {t.projects.over}
                        </span>
                      )}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.contractValue)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(row.endDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.openTasks}</TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                          aria-label={interpolate(t.users.actionsFor, { name: row.name })}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44 bg-card">
                          <DropdownMenuItem onClick={() => openEdit(row)}>
                            <Pencil />
                            {t.projects.editProject}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() =>
                              setPendingDelete({ id: row.id, code: row.code, name: row.name })
                            }
                          >
                            <Trash2 />
                            {t.projects.deleteConfirm}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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

      {isAdmin && (
        <ProjectFormDialog
          // Remount on target change so the form picks up fresh defaultValues.
          key={editingId ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          editingId={editingId}
          initialValues={initialValues}
        />
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {interpolate(t.projects.deleteTitle, { code: pendingDelete?.code ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.projects.deleteDescription, { name: pendingDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = pendingDelete;
                setPendingDelete(null);
                if (target) void confirmDelete(target);
              }}
            >
              {t.projects.deleteConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
