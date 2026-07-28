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
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
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
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { todayIso } from "@/lib/format";
import { summarizeSelection } from "@/lib/summarize-selection";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { useRowSelection } from "@/lib/use-row-selection";
import { trpc } from "@/utils/trpc";

const MOVEMENT_TYPES = ["in", "out", "adjustment"] as const;
const PAGE_SIZE = 25;

type MaterialRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  stock: number;
  reorderLevel: number;
  unitCost: number;
  stockValue: number;
  isLowStock: boolean;
};

export default function MaterialsTable({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const { money, quantity } = useFormat();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [movementTarget, setMovementTarget] = useState<MaterialRow | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const debouncedSearch = useDebounced(search);

  const materialsQuery = useQuery(
    trpc.material.list.queryOptions({
      search: debouncedSearch,
      lowStockOnly,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
  );
  const projectOptions = useQuery(trpc.project.options.queryOptions());
  const deleteMany = useMutation(trpc.material.deleteMany.mutationOptions());

  const materials = materialsQuery.data?.materials ?? [];
  const total = materialsQuery.data?.total ?? 0;
  const lowStockCount = materialsQuery.data?.lowStockTotal ?? 0;
  const hasNextPage = (page + 1) * PAGE_SIZE < total;

  const selection = useRowSelection(materials);
  const editTarget =
    selection.selectedCount === 1
      ? (materials.find((row) => selection.isSelected(row.id)) ?? null)
      : null;

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      await queryClient.invalidateQueries(trpc.material.pathFilter());
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  async function confirmBulkDelete() {
    const ids = selection.selectedIds;
    await run(
      () => deleteMany.mutateAsync({ ids, force: true }),
      interpolate(t.materials.bulkDeletedToast, { count: ids.length }),
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
          placeholder={t.materials.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <Button
          variant={lowStockOnly ? "default" : "outline"}
          size="sm"
          onClick={() => {
            setLowStockOnly((value) => !value);
            setPage(0);
          }}
        >
          <TriangleAlert />
          {t.materials.lowStock}
          {lowStockCount > 0 && !lowStockOnly ? ` (${lowStockCount})` : ""}
        </Button>
        {isAdmin && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t.materials.newMaterial}
          </Button>
        )}
      </div>

      {isAdmin && (
        <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
          {/* Editing is inherently single-row, so it appears only once the
              selection names exactly one thing to edit. */}
          {editTarget && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil />
              {t.common.edit}
            </Button>
          )}
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
                {isAdmin && (
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={selection.allSelected}
                      indeterminate={selection.someSelected}
                      onCheckedChange={selection.toggleAll}
                      aria-label={t.common.selectAll}
                    />
                  </TableHead>
                )}
                <TableHead className={isAdmin ? undefined : "pl-4"}>
                  {t.materials.material}
                </TableHead>
                <TableHead>{t.materials.sku}</TableHead>
                <TableHead className="text-right">{t.materials.onHand}</TableHead>
                <TableHead className="text-right">{t.materials.reorderAt}</TableHead>
                <TableHead className="text-right">{t.materials.unitCost}</TableHead>
                <TableHead className="text-right">{t.materials.stockValue}</TableHead>
                {isAdmin && <TableHead className="pr-4 text-right">{t.common.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {materialsQuery.isPending &&
                Array.from({ length: PAGE_SIZE }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={isAdmin ? 8 : 6} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {materialsQuery.isError && (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 8 : 6} className="p-4">
                    <QueryError
                      error={materialsQuery.error}
                      onRetry={() => void materialsQuery.refetch()}
                      className="border-0"
                    />
                  </TableCell>
                </TableRow>
              )}

              {!materialsQuery.isPending && !materialsQuery.isError && materials.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 8 : 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {lowStockOnly ? t.materials.nothingLow : t.materials.empty}
                  </TableCell>
                </TableRow>
              )}

              {materials.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={selection.isSelected(row.id) ? "selected" : undefined}
                >
                  {isAdmin && (
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selection.isSelected(row.id)}
                        onCheckedChange={() => selection.toggle(row.id)}
                        aria-label={interpolate(t.common.selectRow, { name: row.name })}
                      />
                    </TableCell>
                  )}
                  <TableCell className={isAdmin ? "font-medium" : "pl-4 font-medium"}>
                    {row.name}
                    {row.isLowStock && (
                      <Badge variant="destructive" className="ml-2">
                        <TriangleAlert />
                        {t.materials.lowStock}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">{row.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {quantity(row.stock, row.unit)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.reorderLevel > 0 ? quantity(row.reorderLevel, row.unit) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.unitCost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.stockValue)}</TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4">
                      <div className="flex items-center justify-end">
                        <Button variant="outline" size="sm" onClick={() => setMovementTarget(row)}>
                          {t.materials.record}
                        </Button>
                      </div>
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
            ? t.materials.noMaterials
            : interpolate(t.materials.showing, {
                from: page * PAGE_SIZE + 1,
                to: page * PAGE_SIZE + materials.length,
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
        <>
          <MaterialFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSaved={() => queryClient.invalidateQueries(trpc.material.pathFilter())}
          />
          <MaterialFormDialog
            // Remount per target so defaultValues pick up the new row.
            // Namespaced: this and MovementDialog below are siblings, and both
            // fall back to a placeholder when nothing is targeted — a bare
            // "none" on each collides.
            key={`edit-${editTarget?.id ?? "none"}`}
            editing={editTarget}
            open={editOpen && editTarget !== null}
            onOpenChange={setEditOpen}
            onSaved={() => queryClient.invalidateQueries(trpc.material.pathFilter())}
          />
          <MovementDialog
            key={`movement-${movementTarget?.id ?? "none"}`}
            material={movementTarget}
            projects={projectOptions.data ?? []}
            onClose={() => setMovementTarget(null)}
            onSaved={async () => {
              await queryClient.invalidateQueries(trpc.material.pathFilter());
              await queryClient.invalidateQueries(trpc.project.pathFilter());
            }}
          />

          <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {interpolate(t.common.bulkDeleteTitle, { count: selection.selectedCount })}
                </AlertDialogTitle>
                <AlertDialogDescription className="space-y-2">
                  <span className="block">{t.materials.bulkDeleteDescription}</span>
                  <span className="block font-medium text-foreground">
                    {summarizeSelection(
                      materials
                        .filter((row) => selection.isSelected(row.id))
                        .map((row) => `${row.sku} · ${row.name}`),
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

/**
 * Create and edit share one form: the fields, validation and layout are
 * identical, and `material.update` takes the same shape as `material.create`.
 * Pass `editing` to switch modes — remount with a key so defaultValues refresh,
 * the same way ProjectFormDialog does it.
 */
function MaterialFormDialog({
  open,
  onOpenChange,
  onSaved,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<unknown>;
  editing?: MaterialRow | null;
}) {
  const t = useT();
  const createMaterial = useMutation(trpc.material.create.mutationOptions());
  const updateMaterial = useMutation(trpc.material.update.mutationOptions());
  const isEdit = Boolean(editing);

  const schema = z.object({
    sku: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    name: z.string().trim().min(1).max(200),
    unit: z.string().trim().min(1).max(20),
    reorderLevel: z.number().min(0),
    unitCost: z.number().min(0),
  });

  const form = useForm({
    defaultValues: editing
      ? {
          sku: editing.sku,
          name: editing.name,
          unit: editing.unit,
          reorderLevel: editing.reorderLevel,
          unitCost: editing.unitCost,
        }
      : { sku: "", name: "", unit: "", reorderLevel: 0, unitCost: 0 },
    onSubmit: async ({ value, formApi }) => {
      try {
        if (editing) await updateMaterial.mutateAsync({ id: editing.id, ...value });
        else await createMaterial.mutateAsync(value);
        await onSaved();
        onOpenChange(false);
        formApi.reset();
        toast.success(isEdit ? t.materials.updatedToast : t.materials.createdToast);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : isEdit
              ? t.materials.updateFailed
              : t.materials.createFailed,
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
              {isEdit ? t.materials.editMaterial : t.materials.newMaterial}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="sku">
              {(field) => <TextField label={t.materials.sku} field={field} placeholder="CEM-42" />}
            </form.Field>
            <form.Field name="unit">
              {(field) => <TextField label={t.materials.unit} field={field} placeholder="bag" />}
            </form.Field>
          </div>
          <form.Field name="name">
            {(field) => <TextField label={t.materials.name} field={field} />}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="reorderLevel">
              {(field) => <NumField label={t.materials.reorderLevel} field={field} />}
            </form.Field>
            <form.Field name="unitCost">
              {(field) => <NumField label={t.materials.unitCost} field={field} />}
            </form.Field>
          </div>

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
                      : t.materials.createMaterial}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  material,
  projects,
  onClose,
  onSaved,
}: {
  material: MaterialRow | null;
  projects: { id: string; code: string; name: string }[];
  onClose: () => void;
  onSaved: () => void | Promise<unknown>;
}) {
  const t = useT();
  const { quantity } = useFormat();
  const recordMovement = useMutation(trpc.material.recordMovement.mutationOptions());

  const schema = z.object({
    type: z.enum(MOVEMENT_TYPES),
    quantity: z.number().positive(t.materials.quantityPositive),
    occurredOn: z.iso.date(t.expenses.pickDate),
    projectId: z.string(),
    note: z.string().max(500),
  });

  const form = useForm({
    defaultValues: {
      type: "in" as (typeof MOVEMENT_TYPES)[number],
      quantity: 0,
      occurredOn: todayIso(),
      projectId: "",
      note: "",
    },
    onSubmit: async ({ value }) => {
      if (!material) return;
      try {
        const result = await recordMovement.mutateAsync({
          materialId: material.id,
          type: value.type,
          quantity: value.quantity,
          occurredOn: value.occurredOn,
          projectId: value.projectId === "" ? undefined : value.projectId,
          note: value.note.trim() === "" ? undefined : value.note,
        });
        await onSaved();
        onClose();
        toast.success(
          interpolate(t.materials.movementRecorded, {
            stock: quantity(result.stock, material.unit),
          }),
        );
      } catch (error) {
        // Includes the server's "only N on hand" refusal for over-issuing.
        toast.error(error instanceof Error ? error.message : t.materials.movementFailed);
      }
    },
    validators: { onSubmit: schema },
  });

  return (
    <Dialog
      open={material !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
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
              {interpolate(t.materials.movementTitle, { name: material?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {material &&
                interpolate(t.materials.movementDescription, {
                  stock: quantity(material.stock, material.unit),
                })}
            </DialogDescription>
          </DialogHeader>

          <form.Field name="type">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.materials.movementLabel}</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange((value ?? "in") as (typeof MOVEMENT_TYPES)[number])
                  }
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">
                      <ArrowDownToLine />
                      {t.materials.deliveryIn}
                    </SelectItem>
                    <SelectItem value="out">
                      <ArrowUpFromLine />
                      {t.materials.issuedToSite}
                    </SelectItem>
                    <SelectItem value="adjustment">{t.materials.adjustment}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="quantity">
              {(field) => (
                <NumField
                  label={interpolate(t.materials.quantityLabel, { unit: material?.unit ?? "" })}
                  field={field}
                />
              )}
            </form.Field>
            <form.Field name="occurredOn">
              {(field) => <TextField label={t.materials.dateLabel} field={field} type="date" />}
            </form.Field>
          </div>

          <form.Field name="projectId">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.materials.projectLabel}</Label>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value ?? "")}
                >
                  <SelectTrigger id={field.name} className="w-full">
                    <SelectValue placeholder={t.materials.centralStore} />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.code} · {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>

          <form.Field name="note">
            {(field) => <TextField label={t.materials.note} field={field} />}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <form.Subscribe
              selector={(s) => ({ canSubmit: s.canSubmit, isSubmitting: s.isSubmitting })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting ? t.common.saving : t.materials.recordMovement}
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

function NumField({ label, field }: { label: string; field: any }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        name={field.name}
        type="number"
        min={0}
        step="any"
        value={String(field.state.value)}
        onBlur={field.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
      {field.state.meta.errors.map((error: { message?: string } | undefined) => (
        <p key={error?.message} className="text-xs text-destructive">
          {error?.message}
        </p>
      ))}
    </div>
  );
}
