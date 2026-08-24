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
import { ArchiveOff, ArchiveRestore, Trash2 } from "@DashboardV2/ui/components/icons";
import { Input } from "@DashboardV2/ui/components/input";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { TableEmptyState } from "@/components/table-empty-state";
import { ToolbarAction } from "@/components/table-selection";
import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { summarizeSelection } from "@/lib/summarize-selection";
import { toast } from "@/lib/toast";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

const PAGE_SIZE = 25;

/**
 * The archive list.
 *
 * A leaner sibling of projects-table.tsx rather than a mode of it. That table
 * carries create, Excel import, spreadsheet export and the status filter, none
 * of which an archive wants; threading a flag through would have left every one
 * of those features with an "unless archived" branch. What is genuinely shared
 * is shared as components — the Table primitives, InfiniteLoadMore,
 * useRowSelection, StatusBadge, TableEmptyState, the delete confirmation.
 *
 * The status column is the point of the page. Archiving is a filing action and
 * not a status, so a project that was Completed when it was archived still
 * reads Completed here, and comes back out that way.
 */
export default function ArchiveTable({ canDelete }: { canDelete: boolean }) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const debouncedSearch = useDebounced(search);

  const archiveQuery = useInfiniteQuery(
    trpc.project.list.infiniteQueryOptions(
      { search: debouncedSearch, archived: true, limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );
  const setArchived = useMutation(trpc.project.setArchived.mutationOptions());
  const deleteMany = useMutation(trpc.project.deleteMany.mutationOptions());

  const projects = archiveQuery.data?.pages.flatMap((page) => page.projects) ?? [];
  const total = archiveQuery.data?.pages[0]?.total ?? 0;
  const initialError = archiveQuery.isError && archiveQuery.data === undefined;
  const selection = useRowSelection(projects, {
    getId: (row) => row.id,
    resetKey: debouncedSearch,
    maxSelected: 100,
  });
  const COLUMNS = 5;

  const selected = projects.filter((row) => selection.isSelected(row.id));

  /** Both actions move a row out of this list, so both invalidate the same tree. */
  async function refresh() {
    selection.clear();
    await Promise.all([
      queryClient.invalidateQueries(trpc.project.pathFilter()),
      queryClient.invalidateQueries(trpc.activity.pathFilter()),
    ]);
  }

  async function restore() {
    const ids = selected.map((row) => row.id);
    if (ids.length === 0) return;
    try {
      const result = await setArchived.mutateAsync({ ids, archived: false });
      await refresh();
      toast.success(plural(t.projects.restoredToast, result.count));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.projects.archiveFailed);
    }
  }

  async function deleteSelected() {
    const ids = selected.map((row) => row.id);
    if (ids.length === 0) return;
    try {
      // force: the confirmation below already names what is going, and an
      // archived project is one somebody has already decided they are finished
      // with — a second "these have actions attached" round trip here would be
      // a prompt about a prompt.
      const result = await deleteMany.mutateAsync({ ids, force: true });
      setDeleteOpen(false);
      await refresh();
      toast.success(plural(t.projects.bulkDeletedToast, result.count));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {archiveQuery.isPending ? t.common.loading : ""}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.archive.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />

        {selection.selectedCount > 0 && (
          <>
            <ToolbarAction
              icon={<ArchiveRestore />}
              label={plural(t.projects.restoreSelectedLabel, selection.selectedCount)}
              disabled={setArchived.isPending || deleteMany.isPending}
              onClick={() => void restore()}
            />
            {canDelete && (
              <ToolbarAction
                icon={<Trash2 />}
                variant="destructive"
                label={plural(t.projects.deleteSelectedLabel, selection.selectedCount)}
                disabled={setArchived.isPending || deleteMany.isPending}
                onClick={() => setDeleteOpen(true)}
              />
            )}
          </>
        )}
      </div>

      <Card aria-busy={archiveQuery.isPending || archiveQuery.isFetchingNextPage}>
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
                <TableHead className="w-[38%]">{t.projects.project}</TableHead>
                <TableHead className="w-40">{t.projects.statusLabel}</TableHead>
                <TableHead className="w-[22%]">{t.projects.client}</TableHead>
                <TableHead className="w-36 pr-4">{t.projects.archivedOn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {archiveQuery.isPending &&
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
                      error={archiveQuery.error}
                      onRetry={() => void archiveQuery.refetch()}
                      className="border-0"
                    />
                  </TableCell>
                </TableRow>
              )}

              {!archiveQuery.isPending && !initialError && projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS} className="p-0">
                    <TableEmptyState
                      filtered={debouncedSearch !== ""}
                      onClearFilters={() => setSearch("")}
                      title={debouncedSearch !== "" ? t.archive.noMatch : t.archive.empty}
                      description={t.archive.emptyHint}
                      icon={<ArchiveOff />}
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
                      disabled={!selection.canSelect(row.id)}
                      onCheckedChange={() => selection.toggle(row.id)}
                      aria-label={interpolate(t.common.selectRow, { name: row.name })}
                    />
                  </TableCell>
                  <TableCell className="min-w-0">
                    {/* Still a link. An archived project stays readable, which
                        is most of why it was archived rather than deleted. */}
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
                    {formatDateTime(row.archivedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!initialError && (
        <InfiniteLoadMore
          hasNextPage={archiveQuery.hasNextPage}
          isFetchingNextPage={archiveQuery.isFetchingNextPage}
          isFetchNextPageError={archiveQuery.isFetchNextPageError}
          loadedCount={projects.length}
          total={total}
          onLoadMore={() => void archiveQuery.fetchNextPage()}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plural(t.common.bulkDeleteTitle, selection.selectedCount)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">{t.projects.bulkDeleteDescription}</span>
              <span className="mt-2 block">
                {summarizeSelection(
                  selected.map((row) => `${row.code} - ${row.name}`),
                  t,
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              render={<Button variant="outline" disabled={deleteMany.isPending} />}
            >
              {t.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={deleteMany.isPending} />}
              onClick={() => void deleteSelected()}
            >
              {t.archive.deletePermanently}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
