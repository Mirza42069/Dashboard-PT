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
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import z from "zod";

import { FieldError, fieldError } from "@/components/field-error";
import { DatePicker } from "@DashboardV2/ui/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { ACTION_PRIORITIES, ACTION_TYPES } from "@DashboardV2/db/schema";
import type { ActionPriority, ActionType } from "@DashboardV2/db/schema";
import { useQuery } from "@tanstack/react-query";

import { useLocale, useT } from "@/i18n/provider";
import { datePickerLabels } from "@/lib/date-picker-labels";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

export type TicketFormValues = {
  title: string;
  description: string;
  responsibleName: string;
  responsibleContactNumber: string;
  /**
   * The action fields. Defaulted rather than optional so the form always has a
   * value to render: an uncontrolled select that becomes controlled on first
   * change is React's oldest warning, and "" is not a valid type.
   */
  type: ActionType;
  priority: ActionPriority;
  dueDate: string;
  /** "" means nobody with a login owns this — see the note on assigneeId. */
  assigneeId: string;
};

export const EMPTY_TICKET: TicketFormValues = {
  title: "",
  description: "",
  responsibleName: "",
  responsibleContactNumber: "",
  type: "issue",
  priority: "medium",
  dueDate: "",
  assigneeId: "",
};

const UNASSIGNED = "__unassigned__";

export default function TicketDialog({
  open,
  onOpenChange,
  projectId,
  editingId,
  initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  editingId: string | null;
  initialValues: TicketFormValues;
}) {
  const t = useT();
  const { intlLocale } = useLocale();
  const { formatDate } = useFormat();
  const queryClient = useQueryClient();
  // Only this company's own staff can be assigned — the same list the project
  // manager picker uses, which already excludes super admins.
  const assignees = useQuery(trpc.project.managerOptions.queryOptions());
  const createTicket = useMutation(trpc.ticket.create.mutationOptions());
  const updateTicket = useMutation(trpc.ticket.update.mutationOptions());
  const schema = z.object({
    title: z.string().trim().min(1, t.tickets.titleRequired).max(200),
    description: z.string().trim().min(1, t.tickets.descriptionRequired).max(2000),
    responsibleName: z.string().trim().min(1, t.tickets.responsibleRequired).max(200),
    responsibleContactNumber: z
      .string()
      .trim()
      .min(5, t.tickets.contactRequired)
      .max(50)
      .regex(/^[+0-9() .-]+$/, t.tickets.contactInvalid),
    type: z.enum(ACTION_TYPES),
    priority: z.enum(ACTION_PRIORITIES),
    dueDate: z.string(),
    assigneeId: z.string(),
  });

  const typeOptions = [
    { value: "issue", label: t.actions.typeIssue },
    { value: "rfi", label: t.actions.typeRfi },
    { value: "punch", label: t.actions.typePunch },
    { value: "safety", label: t.actions.typeSafety },
    { value: "quality", label: t.actions.typeQuality },
    { value: "delay", label: t.actions.typeDelay },
    { value: "general", label: t.actions.typeGeneral },
  ];
  const priorityOptions = [
    { value: "low", label: t.actions.priorityLow },
    { value: "medium", label: t.actions.priorityMedium },
    { value: "high", label: t.actions.priorityHigh },
    { value: "critical", label: t.actions.priorityCritical },
  ];

  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        const payload = {
          ...value,
          type: value.type as ActionType,
          priority: value.priority as ActionPriority,
          // "" is the form's way of saying unset; the column is nullable and
          // null is what "no due date" and "nobody assigned" actually mean.
          dueDate: value.dueDate || null,
          assigneeId: value.assigneeId || null,
        };
        if (editingId) {
          await updateTicket.mutateAsync({ id: editingId, ...payload });
        } else {
          await createTicket.mutateAsync({ projectId, ...payload });
        }
        await queryClient.invalidateQueries(trpc.ticket.pathFilter());
        await queryClient.invalidateQueries(trpc.project.pathFilter());
        await queryClient.invalidateQueries(trpc.activity.pathFilter());
        toast.success(t.tickets.saved);
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.tickets.saveFailed);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t.common.close}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingId ? t.tickets.editTicket : t.tickets.newTicket}</DialogTitle>
          </DialogHeader>

          <form.Field name="title">
            {(field) => <TextField label={t.tickets.titleLabel} field={field} />}
          </form.Field>
          <form.Field name="description">
            {(field) => (
              <DescriptionField field={field} label={t.tickets.description} />
            )}
          </form.Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="type">
              {(field) => (
                <ChoiceField
                  label={t.actions.type}
                  value={field.state.value}
                  options={typeOptions}
                  onChange={(value) => field.handleChange(value as ActionType)}
                />
              )}
            </form.Field>
            <form.Field name="priority">
              {(field) => (
                <ChoiceField
                  label={t.actions.priority}
                  value={field.state.value}
                  options={priorityOptions}
                  onChange={(value) => field.handleChange(value as ActionPriority)}
                />
              )}
            </form.Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="dueDate">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="ticket-due">{t.actions.dueDate}</Label>
                  <DatePicker
                    id="ticket-due"
                    value={field.state.value || null}
                    locale={intlLocale}
                    formatValue={formatDate}
                    labels={datePickerLabels(t)}
                    onValueChange={(next) => field.handleChange(next ?? "")}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="assigneeId">
              {(field) => (
                <ChoiceField
                  label={t.actions.assignee}
                  value={field.state.value || UNASSIGNED}
                  options={[
                    { value: UNASSIGNED, label: t.actions.unassigned },
                    ...(assignees.data ?? []).map((person) => ({
                      value: person.id,
                      label: person.name,
                    })),
                  ]}
                  onChange={(value) =>
                    field.handleChange(value === UNASSIGNED ? "" : value)
                  }
                />
              )}
            </form.Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="responsibleName">
              {(field) => <TextField label={t.tickets.responsibleName} field={field} />}
            </form.Field>
            <form.Field name="responsibleContactNumber">
              {(field) => (
                <TextField label={t.tickets.contactNumber} field={field} type="tel" />
              )}
            </form.Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, busy: state.isSubmitting })}>
              {({ canSubmit, busy }) => (
                <Button type="submit" disabled={!canSubmit || busy}>
                  {busy ? t.common.saving : t.tickets.save}
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
function TextField({ label, field, type = "text" }: { label: string; field: any; type?: string }) {
  const error = fieldError(field.name, field.state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        {...error.control}
        name={field.name}
        type={type}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value)}
      />
      <FieldError {...error} />
    </div>
  );
}

function DescriptionField({ label, field }: { label: string; field: any }) {
  const error = fieldError(field.name, field.state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Textarea
        {...error.control}
        name={field.name}
        rows={5}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) =>
          field.handleChange(event.target.value)
        }
      />
      <FieldError {...error} />
    </div>
  );
}

/** A labelled select for the small closed sets an action is classified by. */
function ChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = `choice-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select items={options} value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
