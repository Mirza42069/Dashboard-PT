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
import { ArrowDownToLine, ArrowUpFromLine, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { todayIso } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const MOVEMENT_TYPES = ["in", "out", "adjustment"] as const;

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
  const [createOpen, setCreateOpen] = useState(false);
  const [movementTarget, setMovementTarget] = useState<MaterialRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MaterialRow | null>(null);

  const debouncedSearch = useDebounced(search);

  const materialsQuery = useQuery(
    trpc.material.list.queryOptions({
      search: debouncedSearch,
      lowStockOnly,
      limit: 100,
      offset: 0,
    }),
  );
  const projectOptions = useQuery(trpc.project.options.queryOptions());
  const deleteMaterial = useMutation(trpc.material.delete.mutationOptions());

  const materials = materialsQuery.data?.materials ?? [];
  const lowStockCount = materials.filter((row) => row.isLowStock).length;

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMaterial.mutateAsync({ id: deleteTarget.id });
      await queryClient.invalidateQueries(trpc.material.pathFilter());
      toast.success(t.materials.deletedToast);
    } catch (error) {
      // Carries the server's refusal for a material that has movement history,
      // which is the common case and explains itself better than a generic line.
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.materials.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <Button
          variant={lowStockOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setLowStockOnly((value) => !value)}
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

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.materials.material}</TableHead>
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
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={isAdmin ? 7 : 6} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!materialsQuery.isPending && materials.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 7 : 6}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {lowStockOnly ? t.materials.nothingLow : t.materials.empty}
                  </TableCell>
                </TableRow>
              )}

              {materials.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4 font-medium">
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
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setMovementTarget(row)}>
                          {t.materials.record}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={interpolate(t.materials.deleteLabel, { name: row.name })}
                          onClick={() => setDeleteTarget(row)}
                        >
                          <Trash2 />
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

      {isAdmin && (
        <>
          <CreateMaterialDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onSaved={() => queryClient.invalidateQueries(trpc.material.pathFilter())}
          />
          <MovementDialog
            key={movementTarget?.id ?? "none"}
            material={movementTarget}
            projects={projectOptions.data ?? []}
            onClose={() => setMovementTarget(null)}
            onSaved={async () => {
              await queryClient.invalidateQueries(trpc.material.pathFilter());
              await queryClient.invalidateQueries(trpc.project.pathFilter());
            }}
          />

          <AlertDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t.materials.deleteTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {interpolate(t.materials.deleteConfirm, { name: deleteTarget?.name ?? "" })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void confirmDelete()}>
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

function CreateMaterialDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<unknown>;
}) {
  const t = useT();
  const createMaterial = useMutation(trpc.material.create.mutationOptions());

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
    defaultValues: { sku: "", name: "", unit: "", reorderLevel: 0, unitCost: 0 },
    onSubmit: async ({ value, formApi }) => {
      try {
        await createMaterial.mutateAsync(value);
        await onSaved();
        onOpenChange(false);
        formApi.reset();
        toast.success(t.materials.createdToast);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.materials.createFailed);
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
            <DialogTitle>{t.materials.newMaterial}</DialogTitle>
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
                  {isSubmitting ? t.common.saving : t.materials.createMaterial}
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
