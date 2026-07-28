"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

export type CompanyDraft = { id: string; name: string; code: string };

/**
 * Create and rename in one dialog — the fields are identical, and a company is
 * only a name and a code.
 */
export default function CompanyFormDialog({
  draft,
  onOpenChange,
  onSaved,
}: {
  draft: CompanyDraft | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  const createCompany = useMutation(trpc.company.create.mutationOptions());
  const updateCompany = useMutation(trpc.company.update.mutationOptions());

  // Opened by the table's edit button rather than the trigger below.
  useEffect(() => {
    if (draft) setOpen(true);
  }, [draft]);

  const schema = z.object({
    name: z.string().trim().min(1, t.company.nameRequired).max(120),
    code: z
      .string()
      .trim()
      .min(1, t.company.codeRequired)
      .max(16)
      .regex(/^[A-Za-z0-9-]+$/, t.company.codeFormat),
  });

  const form = useForm({
    defaultValues: { name: draft?.name ?? "", code: draft?.code ?? "" },
    onSubmit: async ({ value, formApi }) => {
      try {
        if (draft) {
          await updateCompany.mutateAsync({ id: draft.id, ...value });
        } else {
          await createCompany.mutateAsync(value);
        }
        await onSaved();
        close(false);
        formApi.reset();
        toast.success(draft ? t.company.updated : t.company.created2);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
      }
    },
    validators: { onSubmit: schema },
  });

  function close(next: boolean) {
    setOpen(next);
    onOpenChange(next);
    if (!next) form.reset();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        {t.company.newCompany}
      </DialogTrigger>
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
            <DialogTitle>{draft ? t.company.editTitle : t.company.createTitle}</DialogTitle>
          </DialogHeader>

          <form.Field name="name">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.company.name}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <form.Field name="code">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.company.code}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                />
                <p className="text-xs text-muted-foreground">{t.company.codeHint}</p>
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
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
                  {isSubmitting ? t.common.saving : t.common.save}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
