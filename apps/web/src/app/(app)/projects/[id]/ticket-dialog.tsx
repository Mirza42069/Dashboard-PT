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
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

export type TicketFormValues = {
  title: string;
  description: string;
  responsibleName: string;
  responsibleContactNumber: string;
};

export const EMPTY_TICKET: TicketFormValues = {
  title: "",
  description: "",
  responsibleName: "",
  responsibleContactNumber: "",
};

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
  const queryClient = useQueryClient();
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
  });

  const form = useForm({
    defaultValues: initialValues,
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        if (editingId) {
          await updateTicket.mutateAsync({ id: editingId, ...value });
        } else {
          await createTicket.mutateAsync({ projectId, ...value });
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
