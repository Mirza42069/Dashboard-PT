"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
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
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "@DashboardV2/ui/components/icons";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import FormShell from "@/components/form-shell";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export type CompanyDraft = {
  id: string;
  name: string;
  code: string;
  vertical: "construction" | "dental";
};

/**
 * Create and rename in one form — the fields are identical, and a company is
 * only a name and a code.
 *
 * The shell differs, though: renaming slides in from the right beside the row
 * it belongs to, creating stays centred. That is FormShell's rule and it is the
 * same one the project form follows, so both edit flows in the app enter the
 * same way.
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
  const formRef = useRef<HTMLFormElement>(null);

  const createCompany = useMutation(trpc.company.create.mutationOptions());
  const updateCompany = useMutation(trpc.company.update.mutationOptions());

  // A rename is opened by the table's edit button handing down a draft, not by
  // the "new company" button above.
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
    vertical: z.enum(["construction", "dental"]),
  });

  const form = useForm({
    defaultValues: {
      name: draft?.name ?? "",
      code: draft?.code ?? "",
      vertical: draft?.vertical ?? ("construction" as "construction" | "dental"),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        if (draft) {
          await updateCompany.mutateAsync({ id: draft.id, name: value.name, code: value.code });
        } else {
          await createCompany.mutateAsync(value);
        }
        await onSaved();
        setFormOpen(false);
        formApi.reset();
        toast.success(draft ? t.company.updated : t.company.createdToast);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
      }
    },
    validators: { onSubmit: schema },
  });

  function setFormOpen(next: boolean) {
    setOpen(next);
    onOpenChange(next);
    if (!next) form.reset();
  }

  const asSheet = draft !== null;

  return (
    <>
      {/* A plain button rather than a DialogTrigger: the trigger has to live
          inside a Dialog, and while a rename is open this component is rendering
          a Sheet instead — the "new company" button would vanish from the
          toolbar mid-edit and collapse the row it sits in. */}
      <Button size="sm" onClick={() => setFormOpen(true)}>
        <Plus />
        {t.company.newCompany}
      </Button>

      <FormShell
        asSheet={asSheet}
        open={open}
        onOpenChange={setFormOpen}
        closeLabel={t.common.close}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
          }}
          className={asSheet ? "flex h-full min-h-0 flex-col" : "space-y-4"}
          noValidate
          ref={formRef}
        >
          {/* DialogHeader/Title work inside the Sheet too: both shells are the
              same @base-ui/react/dialog primitive, so these read the same
              context and label whichever popup is open. */}
          <DialogHeader className={asSheet ? "gap-1 p-4 pr-12" : undefined}>
            <DialogTitle>{draft ? t.company.editTitle : t.company.createTitle}</DialogTitle>
          </DialogHeader>

          <div
            className={
              asSheet ? "min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-2" : "space-y-4"
            }
          >
            <form.Field name="name">
              {(field) => {
                const error = fieldError(field.name, field.state.meta.errors);
                return (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.company.name}</Label>
                    <Input
                      {...error.control}
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError {...error} />
                  </div>
                );
              }}
            </form.Field>

            <form.Field name="vertical">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.company.vertical}</Label>
                  {draft ? (
                    <>
                      <Input
                        id={field.name}
                        value={
                          field.state.value === "dental"
                            ? t.company.verticalDental
                            : t.company.verticalConstruction
                        }
                        readOnly
                      />
                      <p className="text-xs text-muted-foreground">
                        {t.company.verticalImmutable}
                      </p>
                    </>
                  ) : (
                    <Select
                      items={[
                        { value: "construction", label: t.company.verticalConstruction },
                        { value: "dental", label: t.company.verticalDental },
                      ]}
                      value={field.state.value}
                      onValueChange={(value) =>
                        field.handleChange((value ?? "construction") as "construction" | "dental")
                      }
                    >
                      <SelectTrigger id={field.name} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="construction">
                          {t.company.verticalConstruction}
                        </SelectItem>
                        <SelectItem value="dental">{t.company.verticalDental}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <p className="text-xs text-muted-foreground">{t.company.verticalHint}</p>
                </div>
              )}
            </form.Field>

            <form.Field name="code">
              {(field) => {
                // The hint is part of the description too: it explains the format
                // before the mistake, so it should be announced with the field
                // rather than only after validation fails.
                const error = fieldError(field.name, field.state.meta.errors);
                const hintId = `${field.name}-hint`;
                return (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.company.code}</Label>
                    <Input
                      {...error.control}
                      aria-describedby={
                        error.control["aria-describedby"]
                          ? `${hintId} ${error.control["aria-describedby"]}`
                          : hintId
                      }
                      name={field.name}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value.toUpperCase())}
                    />
                    <p id={hintId} className="text-xs text-muted-foreground">
                      {t.company.codeHint}
                    </p>
                    <FieldError {...error} />
                  </div>
                );
              }}
            </form.Field>
          </div>

          <DialogFooter className={asSheet ? "border-t border-border bg-popover p-4" : undefined}>
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
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
      </FormShell>
    </>
  );
}
