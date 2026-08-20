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

import { QueryError } from "@/components/query-error";
import { InfiniteLoadMore } from "@/components/infinite-load-more";
import { useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";

import { useT } from "@/i18n/provider";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import TicketDialog, { EMPTY_TICKET, type TicketFormValues } from "./ticket-dialog";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const ALL = "all";
const PAGE_SIZE = 25;

type DialogState = { id: string | null; values: TicketFormValues };
type DeleteTarget = { id: string; title: string };
type CloseTarget = { id: string; title: string };

export default function TicketsTab({ projectId }: { projectId: string }) {
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
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const [pendingClose, setPendingClose] = useState<CloseTarget | null>(null);
  const [resolution, setResolution] = useState("");
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
  const closeTicket = useMutation(trpc.ticket.close.mutationOptions());
  const deleteTicket = useMutation(trpc.ticket.delete.mutationOptions());

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

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    try {
      await deleteTicket.mutateAsync({ id: target.id });
      await refresh();
      toast.success(t.tickets.deleted);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.tickets.deleteFailed);
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
            <Button size="sm" onClick={() => setDialog({ id: null, values: EMPTY_TICKET })}>
              <Plus />
              {t.tickets.newTicket}
            </Button>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.tickets.titleLabel}</TableHead>
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
                    <TableCell colSpan={6} className="px-4">
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {initialError && (
                <TableRow>
                  <TableCell colSpan={6} className="p-4">
                    <QueryError error={query.error} onRetry={() => void query.refetch()} />
                  </TableCell>
                </TableRow>
              )}
              {!query.isPending && !initialError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
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
                  data-state={row.id === requestedAction ? "selected" : undefined}
                >
                  <TableCell className="pl-4">
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
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Select
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
                    </Select>
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      {row.status !== "closed" && (
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
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.tickets.editTicket}
                        onClick={() =>
                          setDialog({
                            id: row.id,
                            values: {
                              title: row.title,
                              description: row.description,
                              responsibleName: row.responsibleName,
                              responsibleContactNumber: row.responsibleContactNumber,
                              type: row.type,
                              priority: row.priority,
                              dueDate: row.dueDate ?? "",
                              assigneeId: row.assigneeId ?? "",
                            },
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.common.delete}
                        onClick={() => setPendingDelete({ id: row.id, title: row.title })}
                      >
                        <Trash2 />
                      </Button>
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

      {dialog && (
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

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.tickets.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.tickets.deleteDescription, { title: pendingDelete?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              {t.common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
