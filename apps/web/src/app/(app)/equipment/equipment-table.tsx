"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
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
  DropdownMenuSeparator,
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
import { MapPin, MoreHorizontal, Plus, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { StatusBadge, useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const STATUSES = ["available", "in_use", "maintenance", "retired"] as const;
const ALL = "all";
const UNASSIGNED = "unassigned";

type EquipmentRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  projectId: string | null;
};

export default function EquipmentTable({ isAdmin }: { isAdmin: boolean }) {
  const t = useT();
  const { formatDate } = useFormat();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<EquipmentRow | null>(null);

  const equipmentQuery = useQuery(
    trpc.equipment.list.queryOptions({
      search,
      status: status === ALL ? undefined : (status as (typeof STATUSES)[number]),
      limit: 100,
      offset: 0,
    }),
  );
  const projectOptions = useQuery(trpc.project.options.queryOptions());

  const setStatusMutation = useMutation(trpc.equipment.update.mutationOptions());
  const rows = equipmentQuery.data?.equipment ?? [];
  const counts = equipmentQuery.data?.counts;
  const statusItems = [
    { value: ALL, label: t.common.all },
    ...STATUSES.map((value) => ({ value, label: statusLabel("equipment", value) })),
  ];

  async function changeStatus(id: string, next: (typeof STATUSES)[number]) {
    try {
      await setStatusMutation.mutateAsync({ id, status: next });
      await queryClient.invalidateQueries(trpc.equipment.pathFilter());
      toast.success(
        interpolate(t.equipment.marked, {
          status: statusLabel("equipment", next).toLowerCase(),
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.equipment.updateFailed);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.equipment.searchPlaceholder}
          className="w-full sm:max-w-xs"
          aria-label={t.common.search}
        />
        <Select
          items={statusItems}
          value={status}
          onValueChange={(value) => setStatus(value ?? ALL)}
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
        {isAdmin && (
          <Button size="sm" className="ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus />
            {t.equipment.newEquipment}
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">{t.equipment.equipment}</TableHead>
                <TableHead>{t.equipment.category}</TableHead>
                <TableHead>{t.equipment.statusColumn}</TableHead>
                <TableHead>{t.equipment.deployedTo}</TableHead>
                <TableHead>{t.equipment.purchased}</TableHead>
                {isAdmin && <TableHead className="pr-4 text-right">{t.common.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {equipmentQuery.isPending &&
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={isAdmin ? 6 : 5} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}

              {!equipmentQuery.isPending && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isAdmin ? 6 : 5}
                    className="py-10 text-center text-muted-foreground"
                  >
                    {t.equipment.noMatch}
                  </TableCell>
                </TableRow>
              )}

              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4">
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
                  <TableCell className="text-muted-foreground">
                    {formatDate(row.purchaseDate)}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" />}
                          aria-label={interpolate(t.users.actionsFor, { name: row.name })}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 bg-card">
                          <DropdownMenuItem
                            onClick={() =>
                              setAssignTarget({
                                id: row.id,
                                code: row.code,
                                name: row.name,
                                status: row.status,
                                projectId: row.projectId,
                              })
                            }
                          >
                            <MapPin />
                            {t.equipment.assignToSite}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => void changeStatus(row.id, "maintenance")}>
                            <Wrench />
                            {t.equipment.markMaintenance}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void changeStatus(row.id, "available")}>
                            {t.equipment.markAvailable}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => void changeStatus(row.id, "retired")}>
                            {t.equipment.retire}
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

      {isAdmin && (
        <>
          <CreateEquipmentDialog open={createOpen} onOpenChange={setCreateOpen} />
          <AssignDialog
            key={assignTarget?.id ?? "none"}
            target={assignTarget}
            projects={projectOptions.data ?? []}
            onClose={() => setAssignTarget(null)}
          />
        </>
      )}
    </>
  );
}

function CreateEquipmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const createEquipment = useMutation(trpc.equipment.create.mutationOptions());

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
    defaultValues: { code: "", name: "", category: "", purchaseDate: "" },
    onSubmit: async ({ value, formApi }) => {
      try {
        await createEquipment.mutateAsync({
          code: value.code,
          name: value.name,
          category: value.category.trim() === "" ? undefined : value.category,
          purchaseDate: value.purchaseDate === "" ? undefined : value.purchaseDate,
        });
        await queryClient.invalidateQueries(trpc.equipment.pathFilter());
        onOpenChange(false);
        formApi.reset();
        toast.success(t.equipment.added);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.equipment.addFailed);
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
            <DialogTitle>{t.equipment.newEquipment}</DialogTitle>
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
                  {isSubmitting ? t.common.saving : t.equipment.addEquipment}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignDialog({
  target,
  projects,
  onClose,
}: {
  target: EquipmentRow | null;
  projects: { id: string; code: string; name: string }[];
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const assign = useMutation(trpc.equipment.assign.mutationOptions());
  const [projectId, setProjectId] = useState(target?.projectId ?? UNASSIGNED);
  const projectItems = [
    { value: UNASSIGNED, label: t.equipment.yardUnassigned },
    ...projects.map((option) => ({
      value: option.id,
      label: `${option.code} · ${option.name}`,
    })),
  ];

  async function submit() {
    if (!target) return;
    try {
      await assign.mutateAsync({
        id: target.id,
        projectId: projectId === UNASSIGNED ? null : projectId,
      });
      await queryClient.invalidateQueries(trpc.equipment.pathFilter());
      onClose();
      toast.success(
        projectId === UNASSIGNED ? t.equipment.returnedToYard : t.equipment.assignedToSite,
      );
    } catch (error) {
      // Covers the server refusing to deploy equipment under maintenance.
      toast.error(error instanceof Error ? error.message : t.equipment.assignFailed);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {interpolate(t.equipment.assignTitle, { code: target?.code ?? "" })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="assign-project">{t.equipment.site}</Label>
          <Select
            items={projectItems}
            value={projectId}
            onValueChange={(value) => setProjectId(value ?? UNASSIGNED)}
          >
            <SelectTrigger id="assign-project" className="w-full">
              <SelectValue>
                {(value) =>
                  projectItems.find((option) => option.value === value)?.label ??
                  t.equipment.yardUnassigned
                }
              </SelectValue>
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
          <Button onClick={() => void submit()} disabled={assign.isPending}>
            {assign.isPending ? t.common.saving : t.common.save}
          </Button>
        </DialogFooter>
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
