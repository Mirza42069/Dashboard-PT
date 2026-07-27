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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { useT } from "@/i18n/provider";
import { todayIso } from "@/lib/format";
import { trpc } from "@/utils/trpc";

const CATEGORIES = ["labor", "materials", "equipment", "subcontractor", "other"] as const;

export default function AddExpenseDialog({ projectId }: { projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const createExpense = useMutation(trpc.expense.create.mutationOptions());

  const schema = z.object({
    category: z.enum(CATEGORIES),
    description: z.string().trim().min(1, t.expenses.descriptionRequired).max(500),
    amount: z.number().positive(t.expenses.amountPositive),
    incurredOn: z.iso.date(t.expenses.pickDate),
  });

  const form = useForm({
    defaultValues: {
      category: "materials" as (typeof CATEGORIES)[number],
      description: "",
      amount: 0,
      incurredOn: todayIso(),
    },
    onSubmit: async ({ value, formApi }) => {
      try {
        await createExpense.mutateAsync({ projectId, ...value });
        // Both the expense list and the project's budget roll-up change.
        await queryClient.invalidateQueries(trpc.expense.pathFilter());
        await queryClient.invalidateQueries(trpc.project.pathFilter());
        setOpen(false);
        formApi.reset();
        toast.success(t.expenses.recorded);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.expenses.recordFailed);
      }
    },
    validators: { onSubmit: schema },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset();
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        {t.expenses.record}
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
            <DialogTitle>{t.expenses.record}</DialogTitle>
          </DialogHeader>

          <form.Field name="description">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.expenses.description}</Label>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="category">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.expenses.category}</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange((value ?? "materials") as (typeof CATEGORIES)[number])
                    }
                  >
                    <SelectTrigger id={field.name} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {t.expenses.categories[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>

            <form.Field name="incurredOn">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t.expenses.date}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="date"
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
          </div>

          <form.Field name="amount">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t.expenses.amount}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  min={0}
                  step="any"
                  value={String(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
                {field.state.meta.errors.map((error) => (
                  <p key={error?.message} className="text-xs text-destructive">
                    {error?.message}
                  </p>
                ))}
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
                  {isSubmitting ? t.common.saving : t.expenses.record}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
