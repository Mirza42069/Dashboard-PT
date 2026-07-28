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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
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
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { toast } from "sonner";

import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import TicketDialog, { EMPTY_TICKET, type TicketFormValues } from "./ticket-dialog";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const ALL = "all";

type DialogState = { id: string | null; values: TicketFormValues };
type DeleteTarget = { id: string; title: string };

export default function TicketsTab({ projectId }: { projectId: string }) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState<string>(ALL);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const statusOptions = STATUSES.map((value) => ({
    value,
    label: statusLabel("ticket", value),
  }));
  const filterOptions = [{ value: ALL, label: t.common.all }, ...statusOptions];

  const query = useQuery(
    trpc.ticket.listByProject.queryOptions({
      projectId,
      search: deferredSearch,
      status: status === ALL ? undefined : (status as (typeof STATUSES)[number]),
    }),
  );
  const setTicketStatus = useMutation(trpc.ticket.setStatus.mutationOptions());
  const deleteTicket = useMutation(trpc.ticket.delete.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.ticket.pathFilter());
    await queryClient.invalidateQueries(trpc.project.pathFilter());
    await queryClient.invalidateQueries(trpc.activity.pathFilter());
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

  const rows = query.data?.tickets ?? [];
  const filtering = search.trim() !== "" || status !== ALL;

  return (
    <>
      <Card>
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
                      ` (${query.data?.counts[option.value as (typeof STATUSES)[number]] ?? 0})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="px-0">
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
              {!query.isPending && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    {filtering ? t.tickets.noMatch : t.tickets.empty}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4">
                    <p className="font-medium">{row.title}</p>
                    <p className="max-w-md whitespace-pre-wrap text-muted-foreground">
                      {row.description}
                    </p>
                  </TableCell>
                  <TableCell>{row.issuerName}</TableCell>
                  <TableCell>
                    <p>{row.responsibleName}</p>
                    <a
                      href={`tel:${row.responsibleContactNumber.replace(/[^+0-9]/g, "")}`}
                      className="text-muted-foreground hover:underline"
                    >
                      {row.responsibleContactNumber}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Select
                      items={statusOptions}
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
                        {statusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
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
