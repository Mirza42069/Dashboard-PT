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
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button, buttonVariants } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, ListChecks, Pencil, Plus, SearchX, Trash2 } from "@DashboardV2/ui/components/icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { QueryError } from "@/components/query-error";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { useStatusLabel } from "@/components/status-badge";
import { plural } from "@/i18n";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";

import { useT } from "@/i18n/provider";
import { SelectAllHead, SelectRowCell, ToolbarAction } from "@/components/table-selection";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useDebounced } from "@/lib/use-debounced";
import { useRowSelection } from "@/lib/use-row-selection";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import TicketDialog, { EMPTY_TICKET, type TicketFormValues } from "./ticket-dialog";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
type BulkStatus = Exclude<(typeof STATUSES)[number], "closed">;
const ALL = "all";
const PAGE_SIZE = 25;

type DialogState = { id: string | null; values: TicketFormValues };
type CloseTarget = { id: string; title: string };

export default function TicketsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useT();
  const searchParams = useSearchParams();
  const requestedAction = searchParams.get("action");
  const { formatDateTime } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const linkedRowRef = useRef<HTMLTableRowElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState<string>(ALL);
  const debouncedStatus = useDebounced(status);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingClose, setPendingClose] = useState<CloseTarget | null>(null);
  const [resolution, setResolution] = useState("");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const statusOptions = STATUSES.map((value) => ({
    value,
    label: statusLabel("ticket", value),
  }));
  const filterOptions = [{ value: ALL, label: t.common.all }, ...statusOptions];

  const query = useInfiniteQuery(
    trpc.ticket.listByProject.infiniteQueryOptions(
      {
        projectId,
        search: debouncedSearch,
        status:
          debouncedStatus === ALL
            ? undefined
            : (debouncedStatus as (typeof STATUSES)[number]),
        focusId: requestedAction ?? undefined,
        limit: PAGE_SIZE,
      },
      { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
    ),
  );
  const setTicketStatus = useMutation(trpc.ticket.setStatus.mutationOptions());
  const setTicketStatuses = useMutation(trpc.ticket.setStatusMany.mutationOptions());
  const closeTicket = useMutation(trpc.ticket.close.mutationOptions());
  const deleteTickets = useMutation(trpc.ticket.deleteMany.mutationOptions());

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries(trpc.ticket.pathFilter()),
      queryClient.invalidateQueries(trpc.project.pathFilter()),
      queryClient.invalidateQueries(trpc.activity.pathFilter()),
    ]);
  }

  async function changeStatus(id: string, next: (typeof STATUSES)[number]) {
    try {
      await setTicketStatus.mutateAsync({ id, status: next });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.statusFailed);
    }
  }

  async function confirmClose() {
    const target = pendingClose;
    const trimmedResolution = resolution.trim();
    if (!target || !trimmedResolution) return;
    try {
      await closeTicket.mutateAsync({ id: target.id, resolution: trimmedResolution });
      setPendingClose(null);
      setResolution("");
      await refresh();
      toast.success(t.actions.closed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.statusFailed);
    }
  }

  const rows = query.data?.pages.flatMap((page) => page.tickets) ?? [];
  // Reset on a server filter change, not on a refetch: narrowing the list is a
  // new question, a background refresh of the same one is not.
  const selection = useRowSelection(rows, {
    getId: (row) => row.id,
    resetKey: `${debouncedSearch}\u0000${debouncedStatus}`,
    maxSelected: 100,
  });

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    try {
      const result = await deleteTickets.mutateAsync({ ids });
      await refresh();
      toast.success(plural(t.tickets.bulkDeletedToast, result.count));
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.bulkDeleteFailed);
    }
  }

  async function changeStatusSelected(next: BulkStatus) {
    const ids = selection.selectedIds;
    if (ids.length === 0) return;
    try {
      await setTicketStatuses.mutateAsync({ ids, status: next });
      await refresh();
      selection.clear();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.statusFailed);
    }
  }
  const total = query.data?.pages[0]?.total ?? 0;
  const counts = query.data?.pages[0]?.counts;
  const initialError = query.isError && query.data === undefined;
  const requestedActionFound = rows.some((row) => row.id === requestedAction);
  const filtering = debouncedSearch !== "" || debouncedStatus !== ALL;

  useEffect(() => {
    if (requestedActionFound) linkedRowRef.current?.focus();
  }, [requestedActionFound, requestedAction]);

  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {query.isPending ? t.common.loading : ""}
      </p>
      <Card aria-busy={query.isPending || query.isFetchingNextPage}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{t.tickets.title}</CardTitle>
            {canEdit && (
              <Button size="sm" onClick={() => setDialog({ id: null, values: EMPTY_TICKET })}>
                <Plus />
                {t.tickets.newTicket}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.tickets.searchPlaceholder}
              className="w-full sm:max-w-xs"
              aria-label={t.common.search}
            />
            <Select items={filterOptions} value={status} onValueChange={(value) => setStatus(value ?? ALL)}>
              <SelectTrigger className="w-40" aria-label={t.tickets.statusColumn}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filterOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                    {option.value !== ALL &&
                      ` (${counts?.[option.value as (typeof STATUSES)[number]] ?? 0})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {!query.isPending && !initialError && requestedAction && !requestedActionFound && (
            <div role="status" className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/35 bg-muted/30 p-3">
              <p className="text-sm">{t.actions.linkedActionMissing}</p>
              <Link
                href={`/projects/${projectId}?tab=tickets`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {t.actions.showAll}
              </Link>
            </div>
          )}
          {canEdit && <div className="px-4 pb-2">
            <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
              <Select
                items={statusOptions}
                value=""
                onValueChange={(value) =>
                  void changeStatusSelected(value as BulkStatus)
                }
              >
                <SelectTrigger size="sm" className="w-44" aria-label={t.tickets.setStatusSelected}>
                  <SelectValue placeholder={t.tickets.setStatusSelected} />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.filter((option) => option.value !== "closed").map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Edit is a single-row action: there is no sensible way to set
                  one title on twelve tickets, so it is offered only when the
                  selection is exactly one. */}
              <ToolbarAction
                icon={<Pencil />}
                label={t.tickets.editSelected}
                disabled={selection.selectedCount !== 1}
                onClick={() => {
                  const target = rows.find((row) => row.id === selection.selectedIds[0]);
                  if (!target) return;
                  setDialog({
                    id: target.id,
                    values: {
                      title: target.title,
                      description: target.description,
                      responsibleName: target.responsibleName,
                      responsibleContactNumber: target.responsibleContactNumber,
                      type: target.type,
                      priority: target.priority,
                      dueDate: target.dueDate ?? "",
                    },
                  });
                }}
              />
              <ToolbarAction
                icon={<Trash2 />}
                variant="destructive"
                label={plural(t.tickets.deleteSelectedLabel, selection.selectedCount)}
                onClick={() => setBulkDeleteOpen(true)}
              />
            </BulkActionsBar>
          </div>}
          <Table className="min-w-[48rem] table-fixed">
            <TableHeader>
              <TableRow>
                {canEdit ? <SelectAllHead selection={selection} /> : <TableHead className="w-10" />}
                <TableHead className="w-[26%]">{t.tickets.titleLabel}</TableHead>
                <TableHead>{t.tickets.issuer}</TableHead>
                <TableHead>{t.tickets.responsibleName}</TableHead>
                <TableHead>{t.tickets.created}</TableHead>
                <TableHead className="w-40">{t.tickets.statusColumn}</TableHead>
                <TableHead className="pr-4 text-right">{t.tickets.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending &&
                Array.from({ length: 4 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={7} className="px-4">
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {initialError && (
                <TableRow>
                  <TableCell colSpan={7} className="p-4">
                    <QueryError error={query.error} onRetry={() => void query.refetch()} />
                  </TableCell>
                </TableRow>
              )}
              {!query.isPending && !initialError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Empty className="border-0 py-6">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          {filtering ? <SearchX /> : <ListChecks />}
                        </EmptyMedia>
                        <EmptyTitle>
                          {filtering ? t.tickets.noMatch : t.tickets.empty}
                        </EmptyTitle>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  ref={row.id === requestedAction ? linkedRowRef : undefined}
                  tabIndex={row.id === requestedAction ? -1 : undefined}
                  aria-current={row.id === requestedAction ? "true" : undefined}
                  // The deep-linked row is highlighted the same way a selected
                  // one is, so selection wins where both apply rather than the
                  // two fighting over the attribute.
                  data-state={
                    selection.isSelected(row.id) || row.id === requestedAction
                      ? "selected"
                      : undefined
                  }
                >
                  {canEdit ? (
                    <SelectRowCell selection={selection} id={row.id} name={row.title} />
                  ) : (
                    <TableCell />
                  )}
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{row.title}</p>
                      {row.id === requestedAction && (
                        <Badge variant="secondary">{t.actions.linkedAction}</Badge>
                      )}
                    </div>
                    <p className="max-w-md whitespace-pre-wrap text-muted-foreground">
                      {row.description}
                    </p>
                  </TableCell>
                  <TableCell>{row.issuerName}</TableCell>
                  <TableCell>
                    <p>{row.responsibleName}</p>
                    <a
                      href={`tel:${row.responsibleContactNumber.replace(/[^+0-9]/g, "")}`}
                      className="whitespace-nowrap text-muted-foreground hover:underline"
                    >
                      {row.responsibleContactNumber}
                    </a>
                  </TableCell>
                  <TableCell className="truncate text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {canEdit ? <Select
                      items={statusOptions.filter(
                        (option) => option.value !== "closed" || row.status === "closed",
                      )}
                      value={row.status}
                      onValueChange={(value) =>
                        void changeStatus(
                          row.id,
                          (value ?? row.status) as (typeof STATUSES)[number],
                        )
                      }
                    >
                      <SelectTrigger size="sm" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions
                          .filter((option) => option.value !== "closed" || row.status === "closed")
                          .map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                          ))}
                      </SelectContent>
                    </Select> : <Badge variant="outline">{statusLabel("ticket", row.status)}</Badge>}
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      {canEdit && row.status !== "closed" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t.actions.close}
                          onClick={() => {
                            setResolution("");
                            setPendingClose({ id: row.id, title: row.title });
                          }}
                        >
                          <CircleCheck />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!initialError && (
        <InfiniteLoadMore
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          isFetchNextPageError={query.isFetchNextPageError}
          loadedCount={rows.length}
          total={total}
          onLoadMore={() => void query.fetchNextPage()}
        />
      )}

      {canEdit && dialog && (
        <TicketDialog
          key={dialog.id ?? "new"}
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          projectId={projectId}
          editingId={dialog.id}
          initialValues={dialog.values}
        />
      )}

      <AlertDialog
        open={pendingClose !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingClose(null);
            setResolution("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.actions.closeTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pendingClose?.title}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="action-resolution">{t.actions.resolution}</Label>
            <Textarea
              id="action-resolution"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              placeholder={t.actions.resolutionPlaceholder}
              maxLength={2000}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!resolution.trim() || closeTicket.isPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmClose();
              }}
            >
              {t.actions.close}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {plural(t.common.bulkDeleteTitle, selection.selectedCount)}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">{t.tickets.bulkDeleteDescription}</span>
              {/* Names them, rather than only counting them. "Delete 12
                  items?" is thin grounds for confirming something
                  irreversible; a few titles let a mistake be recognised. */}
              <span className="block font-medium text-foreground">
                {summarizeSelection(
                  selection.selectedRows.map((row) => row.title),
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
