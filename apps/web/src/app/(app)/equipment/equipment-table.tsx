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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@DashboardV2/ui/components/dropdown-menu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { QueryError } from "@/components/query-error";
import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

const STATUSES = ["available", "in_use", "maintenance", "retired"] as const;
const ALL = "all";
const UNASSIGNED = "unassigned";
const PAGE_SIZE = 25;

export default function EquipmentTable({ canManage }: { canManage: boolean }) {
  const t = useT();
  const { formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  // The input stays bound to `search` so typing is responsive; only the settled
  // value reaches the query key, which is what triggers the request.
  const debouncedSearch = useDebounced(search);

  const equipmentQuery = useQuery(
    trpc.equipment.list.queryOptions({
      search: debouncedSearch,
      status: status === ALL ? undefined : (status as (typeof STATUSES)[number]),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );
  // Only feeds the assign dialog, which is admin-only — a regular user would
  // pay for a list of every project in the company and never see it.
  const projectOptions = useQuery({
    ...trpc.project.options.queryOptions(),
    enabled: canManage,
  });

  const deleteMany = useMutation(trpc.equipment.deleteMany.mutationOptions());
  const statusMany = useMutation(trpc.equipment.updateStatusMany.mutationOptions());
  const assignMany = useMutation(trpc.equipment.assignMany.mutationOptions());

  const rows = equipmentQuery.data?.equipment ?? [];
  const counts = equipmentQuery.data?.counts;
  const statusItems = [
    { value: ALL, label: t.common.all },
    ...STATUSES.map((value) => ({ value, label: statusLabel("equipment", value) })),
  ];
  const total = equipmentQuery.data?.total ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  const selection = useRowSelection(rows);
  const editTarget =
    selection.selectedCount === 1
      ? (rows.find((row) => selection.isSelected(row.id)) ?? null)
      : null;

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      await queryClient.invalidateQueries(trpc.equipment.pathFilter());
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  async function bulkStatus(next: (typeof STATUSES)[number]) {
    const ids = selection.selectedIds;
    await run(
      () => statusMany.mutateAsync({ ids, status: next }),
      interpolate(t.equipment.statusChangedToast, { count: ids.length }),
    );
    selection.clear();
  }

  async function bulkAssign(projectId: string | null) {
    const ids = selection.selectedIds;
    await run(
      () => assignMany.mutateAsync({ ids, projectId }),
      interpolate(t.equipment.assignedToast, { count: ids.length }),
    );
    selection.clear();
  }

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
    await run(
      () => deleteMany.mutateAsync({ ids }),
      interpolate(t.equipment.bulkDeletedToast, { count: ids.length }),
    );
    selection.clear();
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
          placeholder={t.equipment.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <Select
          items={statusItems}
          value={status}
          onValueChange={(value) => {
            setStatus(value ?? ALL);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-44" aria-label={t.equipment.statusColumn}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.common.all}</SelectItem>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {statusLabel("equipment", value)}
                {counts ? ` (${counts[value]})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t.equipment.newEquipment}
          </Button>
        )}
      </div>

      {canManage && (
        <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
          {/* Editing is inherently single-row, so it appears only once the
              selection names exactly one thing to edit. */}
          {editTarget && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              {t.common.edit}
            </Button>
          )}
          {/* A menu, not a Select: these are actions applied to the selection,
              and nothing here holds a value afterwards. */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Wrench />
              {t.equipment.setStatus}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-card">
              {STATUSES.map((value) => (
                <DropdownMenuItem key={value} onClick={() => void bulkStatus(value)}>
                  {statusLabel("equipment", value)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setBulkAssignOpen(true)}>
            <MapPin />
            {t.equipment.assignSelected}
          </Button>
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
                <TableHead className={canManage ? undefined : "pl-4"}>
                  {t.equipment.equipment}
                </TableHead>
                <TableHead>{t.equipment.category}</TableHead>
                <TableHead>{t.equipment.statusColumn}</TableHead>
                <TableHead>{t.equipment.deployedTo}</TableHead>
                <TableHead className="pr-4">{t.equipment.purchased}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipmentQuery.isPending &&
                // PAGE_SIZE, not a token 5 — the skeleton is there to reserve
                // the height the page will actually occupy.
                Array.from({ length: PAGE_SIZE }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={canManage ? 6 : 5} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {/* Before the empty state, or a failed fetch reads as "no results
                  match your filters" — which sends the user off adjusting
                  filters to fix a network error. */}
              {equipmentQuery.isError && (
                <TableRow>
                  <TableCell colSpan={canManage ? 6 : 5} className="p-4">
                    <QueryError
                      error={equipmentQuery.error}
                      onRetry={() => void equipmentQuery.refetch()}
                      className="border-0"
                    />
                  </TableCell>
                </TableRow>
              )}

              {!equipmentQuery.isPending && !equipmentQuery.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 6 : 5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t.equipment.noMatch}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => (
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
                    <span className="font-medium">{row.name}</span>
                    <p className="font-mono text-muted-foreground">{row.code}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.category ?? "—"}</TableCell>
                  <TableCell>
                    <StatusBadge kind="equipment" value={row.status} />
                  </TableCell>
                  <TableCell>
                    {row.projectId ? (
                      <Link
                        href={`/projects/${row.projectId}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <MapPin className="size-3.5" />
                        {row.projectCode}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{t.equipment.yard}</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    {formatDate(row.purchaseDate)}
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
            ? t.equipment.noEquipment
            : interpolate(t.equipment.showing, {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + rows.length,
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
        <>
          <EquipmentFormDialog open={createOpen} onOpenChange={setCreateOpen} />
          <EquipmentFormDialog
            // Remount per target so defaultValues pick up the new row.
            key={`edit-${editTarget?.id ?? "none"}`}
            editing={editTarget}
            open={editOpen && editTarget !== null}
            onOpenChange={setEditOpen}
          />
          <BulkAssignDialog
            open={bulkAssignOpen}
            count={selection.selectedCount}
            projects={projectOptions.data ?? []}
            onClose={() => setBulkAssignOpen(false)}
            onAssign={(projectId) => void bulkAssign(projectId)}
          />

          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {interpolate(t.common.bulkDeleteTitle, { count: selection.selectedCount })}
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">{t.equipment.bulkDeleteDescription}</span>
                  <span className="block font-medium text-foreground">
                    {summarizeSelection(
                      rows
                        .filter((row) => selection.isSelected(row.id))
                        .map((row) => `${row.code} · ${row.name}`),
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
      )}
    </>
  );
}

/** Site picker for the selection. "Yard" means unassigned, and sends null. */
function BulkAssignDialog({
  open,
  count,
  projects,
  onClose,
  onAssign,
}: {
  open: boolean;
  count: number;
  projects: { id: string; code: string; name: string }[];
  onClose: () => void;
  onAssign: (projectId: string | null) => void;
}) {
  const t = useT();
  const [value, setValue] = useState<string>(UNASSIGNED);
  const projectItems = [
    { value: UNASSIGNED, label: t.equipment.yardUnassigned },
    ...projects.map((option) => ({
      value: option.id,
      label: `${option.code} · ${option.name}`,
    })),
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.equipment.assignSelected}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>{t.equipment.site}</Label>
          <Select
            items={projectItems}
            value={value}
            onValueChange={(next) => setValue(next ?? UNASSIGNED)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>{t.equipment.yardUnassigned}</SelectItem>
              {projects.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.code} · {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => {
              onClose();
              onAssign(value === UNASSIGNED ? null : value);
            }}
          >
            {interpolate(t.common.selected, { count })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Row shape the edit form needs — a subset of what equipment.list returns. */
type EditableEquipment = {
  id: string;
  code: string;
  name: string;
  category: string | null;
  purchaseDate: string | null;
};

/**
 * Create and edit share one form: same fields, same validation, and
 * `equipment.update` accepts the same shape as `equipment.create`. Pass
 * `editing` to switch modes, and remount with a key so defaultValues refresh.
 */
function EquipmentFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: EditableEquipment | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const createEquipment = useMutation(trpc.equipment.create.mutationOptions());
  const updateEquipment = useMutation(trpc.equipment.update.mutationOptions());
  const isEdit = Boolean(editing);

  const schema = z.object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().max(100),
    purchaseDate: z.string(),
  });

  const form = useForm({
    defaultValues: editing
      ? {
          code: editing.code,
          name: editing.name,
          category: editing.category ?? "",
          purchaseDate: editing.purchaseDate ?? "",
        }
      : { code: "", name: "", category: "", purchaseDate: "" },
    onSubmit: async ({ value, formApi }) => {
      try {
        const payload = {
          code: value.code,
          name: value.name,
          category: value.category.trim() === "" ? undefined : value.category,
          purchaseDate: value.purchaseDate === "" ? undefined : value.purchaseDate,
        };
        if (editing) await updateEquipment.mutateAsync({ id: editing.id, ...payload });
        else await createEquipment.mutateAsync(payload);
        await queryClient.invalidateQueries(trpc.equipment.pathFilter());
        onOpenChange(false);
        formApi.reset();
        toast.success(isEdit ? t.equipment.updatedToast : t.equipment.added);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : isEdit
              ? t.equipment.updateFailed
              : t.equipment.addFailed,
        );
      }
    },
    validators: { onSubmit: schema },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>
              {isEdit ? t.equipment.editEquipment : t.equipment.newEquipment}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="code">
              {(field) => <TextField label={t.equipment.code} field={field} placeholder="EQ-014" />}
            </form.Field>
            <form.Field name="category">
              {(field) => (
                <TextField label={t.equipment.category} field={field} placeholder="Excavator" />
              )}
            </form.Field>
          </div>
          <form.Field name="name">
            {(field) => <TextField label={t.equipment.name} field={field} />}
          </form.Field>
          <form.Field name="purchaseDate">
            {(field) => <TextField label={t.equipment.purchaseDate} field={field} type="date" />}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting
                    ? t.common.saving
                    : isEdit
                      ? t.common.save
                      : t.equipment.addEquipment}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- TanStack Form field API */
function TextField({
  label,
  field,
  type = "text",
  placeholder,
}: {
  label: string;
  field: any;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
      />
      {field.state.meta.errors.map((error: { message?: string } | undefined) => (
        <p key={error?.message} className="text-xs text-destructive">
          {error?.message}
        </p>
      ))}
    </div>
  );
}
