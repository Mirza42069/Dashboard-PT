"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
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
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import z from "zod";

import { useStatusLabel } from "@/components/status-badge";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "completed", "cancelled"] as const;

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(/^[A-Za-z0-9-]+$/),
    name: z.string().trim().min(1).max(200),
    client: z.string().trim().max(200),
    location: z.string().trim().max(200),
    status: z.enum(PROJECT_STATUSES),
    contractValue: z.number().min(0),
    budget: z.number().min(0),
    progress: z.number().int().min(0).max(100),
    managerId: z.string(),
    notes: z.string().max(2000),
  });

export type ProjectFormValues = z.infer<typeof schema>;

export const EMPTY_PROJECT: ProjectFormValues = {
  code: "",
  name: "",
  client: "",
  location: "",
  status: "planning",
  contractValue: 0,
  budget: 0,
  progress: 0,
  managerId: "",
  notes: "",
};

/** Optional text fields go to the API as undefined, not "". */
function blankToUndefined(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export default function ProjectFormDialog({
  open,
  onOpenChange,
  editingId,
  initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create, otherwise the project being edited. */
  editingId: string | null;
  initialValues: ProjectFormValues;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const queryClient = useQueryClient();
  const managers = useQuery(trpc.task.assignees.queryOptions());

  const createProject = useMutation(trpc.project.create.mutationOptions());
  const updateProject = useMutation(trpc.project.update.mutationOptions());

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const payload = {
        code: value.code,
        name: value.name,
        client: blankToUndefined(value.client),
        location: blankToUndefined(value.location),
        status: value.status,
        contractValue: value.contractValue,
        budget: value.budget,
        progress: value.progress,
        managerId: blankToUndefined(value.managerId),
        notes: blankToUndefined(value.notes),
      };

      try {
        if (editingId) {
          await updateProject.mutateAsync({ id: editingId, ...payload });
          toast.success(t.projects.updated);
        } else {
          await createProject.mutateAsync(payload);
          toast.success(t.projects.created);
        }
        await queryClient.invalidateQueries(trpc.project.pathFilter());
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.projects.saveFailed);
      }
    },
    validators: { onSubmit: schema },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{editingId ? t.projects.editProject : t.projects.newProject}</DialogTitle>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="code">
                {(field) => <Field label={t.projects.code} field={field} placeholder="PRJ-001" />}
              </form.Field>
              <form.Field name="status">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.projects.statusLabel}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) =>
                        field.handleChange((value ?? "planning") as ProjectFormValues["status"])
                      }
                    >
                      <SelectTrigger id={field.name} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {statusLabel("project", status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="name">
              {(field) => <Field label={t.projects.name} field={field} />}
            </form.Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="client">
                {(field) => <Field label={t.projects.client} field={field} />}
              </form.Field>
              <form.Field name="location">
                {(field) => <Field label={t.projects.location} field={field} />}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="contractValue">
                {(field) => <NumberField label={t.projects.contractValue} field={field} />}
              </form.Field>
              <form.Field name="budget">
                {(field) => <NumberField label={t.projects.budget} field={field} />}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="progress">
                {(field) => <NumberField label={t.projects.progressPercent} field={field} max={100} />}
              </form.Field>
              <form.Field name="managerId">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.projects.manager}</Label>
                    <Select
                      value={field.state.value}
                      onValueChange={(value) => field.handleChange(value ?? "")}
                    >
                      <SelectTrigger id={field.name} className="w-full">
                        <SelectValue placeholder={t.common.unassigned} />
                      </SelectTrigger>
                      <SelectContent>
                        {(managers.data ?? []).map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="notes">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.projects.notes}</Label>
                  <Textarea
                    id={field.name}
                    name={field.name}
                    rows={3}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <form.Subscribe
              selector={(state) => ({
                canSubmit: state.canSubmit,
                isSubmitting: state.isSubmitting,
              })}
            >
              {({ canSubmit, isSubmitting }) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting}>
                  {isSubmitting
                    ? t.common.saving
                    : editingId
                      ? t.projects.saveChanges
                      : t.projects.createProject}
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
function Field({
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

function NumberField({ label, field, max }: { label: string; field: any; max?: number }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        id={field.name}
        name={field.name}
        type="number"
        min={0}
        max={max}
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
