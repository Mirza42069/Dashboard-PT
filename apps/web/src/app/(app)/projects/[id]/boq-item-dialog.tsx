"use client";

import { Button } from "@DashboardV2/ui/components/button";
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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import z from "zod";

import { FieldError, fieldError } from "@/components/field-error";
import { useT } from "@/i18n/provider";
import {
  formatRupiahInput,
  formatRupiahInputText,
  parseRupiahInput,
} from "@/lib/format";
import { trpc } from "@/utils/trpc";

const PROGRESS_MODES = ["by_quantity", "by_percent"] as const;

const schema = z.object({
  code: z.string().trim().min(1).max(32),
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(20),
  quantity: z.number().min(0),
  unitRate: z.number().min(0),
  progressMode: z.enum(PROGRESS_MODES),
});

export type BoqItemFormValues = z.infer<typeof schema>;

export const EMPTY_BOQ_ITEM: BoqItemFormValues = {
  code: "",
  description: "",
  unit: "",
  quantity: 0,
  unitRate: 0,
  progressMode: "by_quantity",
};

/**
 * Weight is deliberately absent from this form. It is derived from value, so
 * offering it as a field would invite hand-set numbers that stop the BoQ
 * totalling 100% and block baselining for reasons the user never sees. The API
 * still supports manual weights for anyone who needs the escape hatch.
 */
export default function BoqItemDialog({
  open,
  onOpenChange,
  versionId,
  parentId,
  editingId,
  initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  versionId: string;
  /** Null creates a section; an id creates a line inside that section. */
  parentId: string | null;
  /** Null creates, otherwise the item being edited. */
  editingId: string | null;
  initialValues: BoqItemFormValues;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const progressModeOptions = [
    { value: "by_quantity", label: t.boq.byQuantity },
    { value: "by_percent", label: t.boq.byPercent },
  ];

  const createItem = useMutation(trpc.boq.createItem.mutationOptions());
  const updateItem = useMutation(trpc.boq.updateItem.mutationOptions());

  const isSection = parentId === null;

  const form = useForm({
    defaultValues: initialValues,
    onSubmit: async ({ value }) => {
      const payload = {
        code: value.code,
        description: value.description,
        unit: value.unit.trim() === "" ? null : value.unit.trim(),
        quantity: value.quantity,
        unitRate: value.unitRate,
        progressMode: value.progressMode,
      };

      try {
        if (editingId) {
          await updateItem.mutateAsync({ id: editingId, ...payload });
        } else {
          await createItem.mutateAsync({ versionId, parentId, ...payload });
        }
        await queryClient.invalidateQueries(trpc.boq.pathFilter());
        await queryClient.invalidateQueries(trpc.progress.pathFilter());
        toast.success(t.boq.saved);
        onOpenChange(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.boq.saveFailed);
      }
    },
    validators: { onSubmit: schema },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" closeLabel={t.common.close}>
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
              {editingId ? t.boq.editLine : isSection ? t.boq.addSection : t.boq.addLine}
            </DialogTitle>
            <DialogDescription>{isSection ? t.boq.section : t.boq.line}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
              <form.Field name="code">
                {(field) => (
                  <TextField label={t.boq.code} field={field} placeholder={isSection ? "1" : "1.1"} />
                )}
              </form.Field>
              <form.Field name="description">
                {(field) => <TextField label={t.boq.description} field={field} />}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <form.Field name="unit">
                {(field) => <TextField label={t.boq.unit} field={field} placeholder="m3" />}
              </form.Field>
              <form.Field name="quantity">
                {(field) => <NumberField label={t.boq.quantity} field={field} />}
              </form.Field>
              <form.Field name="unitRate">
                {(field) => (
                  <RupiahField
                    label={t.boq.unitRate}
                    field={field}
                    initialValue={initialValues.unitRate}
                  />
                )}
              </form.Field>
            </div>

            <form.Field name="progressMode">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.boq.measuredBy}</Label>
                  <Select
                    items={progressModeOptions}
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange((value ?? "by_quantity") as BoqItemFormValues["progressMode"])
                    }
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {progressModeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

/* eslint-disable @typescript-eslint/no-explicit-any -- TanStack Form field API */
function TextField({
  label,
  field,
  placeholder,
}: {
  label: string;
  field: any;
  placeholder?: string;
}) {
  const error = fieldError(field.name, field.state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        {...error.control}
        name={field.name}
        placeholder={placeholder}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
      />
      <FieldError {...error} />
    </div>
  );
}

function NumberField({ label, field }: { label: string; field: any }) {
  const error = fieldError(field.name, field.state.meta.errors);

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        {...error.control}
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
      <FieldError {...error} />
    </div>
  );
}

function RupiahField({
  label,
  field,
  initialValue,
}: {
  label: string;
  field: any;
  initialValue: number;
}) {
  const error = fieldError(field.name, field.state.meta.errors);
  const [inputValue, setInputValue] = useState(() => formatRupiahInput(field.state.value));

  useEffect(() => {
    setInputValue(formatRupiahInput(initialValue));
  }, [initialValue]);

  return (
    <div className="space-y-2">
      <Label htmlFor={field.name}>{label}</Label>
      <Input
        {...error.control}
        id={field.name}
        name={field.name}
        type="text"
        inputMode="decimal"
        value={inputValue}
        onBlur={() => {
          field.handleBlur();
          setInputValue(formatRupiahInput(field.state.value));
        }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const formatted = formatRupiahInputText(e.target.value);
          setInputValue(formatted);
          field.handleChange(parseRupiahInput(formatted));
        }}
      />
      <FieldError {...error} />
    </div>
  );
}
