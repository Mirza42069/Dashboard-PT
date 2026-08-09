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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export type RenameTarget = { id: string; name: string; isSelf: boolean };

export default function RenameUserDialog({
  target,
  onClose,
}: {
  target: RenameTarget;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const renameUser = useMutation(trpc.admin.renameUser.mutationOptions());
  const schema = z.object({
    name: z.string().trim().min(1, t.users.nameRequired).max(120),
  });
  const form = useForm({
    defaultValues: { name: target.name },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await renameUser.mutateAsync({ userId: target.id, name: value.name });
        await Promise.all([
          queryClient.invalidateQueries(trpc.admin.pathFilter()),
          queryClient.invalidateQueries(trpc.project.pathFilter()),
          queryClient.invalidateQueries(trpc.activity.pathFilter()),
        ]);
        toast.success(t.users.renamedToast);
        onClose();
        if (target.isSelf) router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.users.renameFailed);
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t.common.close}>
        <form
          ref={formRef}
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.users.renameTitle}</DialogTitle>
          </DialogHeader>

          <form.Field name="name">
            {(field) => {
              const error = fieldError(field.name, field.state.meta.errors);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.users.fullName}</Label>
                  <Input
                    {...error.control}
                    autoComplete="name"
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <FieldError {...error} />
                </div>
              );
            }}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t.users.renaming : t.users.rename}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
