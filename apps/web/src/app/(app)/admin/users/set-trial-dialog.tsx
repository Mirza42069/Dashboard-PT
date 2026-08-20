"use client";

import {
  DEFAULT_TRIAL_AI_CREDITS,
  DEFAULT_TRIAL_DAYS,
  MAX_TRIAL_AI_CREDITS,
  MAX_TRIAL_DAYS,
  isTrialAccount,
  trialHasEnded,
} from "@DashboardV2/api/lib/trial";
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
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export type TrialTarget = {
  id: string;
  name: string;
  trialEndsAt: Date | string | null;
  trialAiCredits: number | null;
};

/**
 * Sets a trial's length and AI allowance.
 *
 * Both fields are absolute, not deltas, and the description says so — an admin
 * reading a possibly-stale row cannot reason about "add 7 days" without knowing
 * exactly how many are left, whereas "7 days from now" means the same thing
 * whenever they press the button.
 */
export default function SetTrialDialog({
  target,
  onClose,
}: {
  target: TrialTarget;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const setTrial = useMutation(trpc.admin.setTrial.mutationOptions());
  const ended = trialHasEnded(target);
  const title = ended
    ? t.users.retrialTitle
    : isTrialAccount(target)
      ? t.users.extendTrial
      : t.users.setTrialTitle;

  // Validated as strings rather than coerced numbers: the inputs hold strings,
  // and a coercing schema would report its errors against a shape the form
  // does not have.
  const wholeNumberIn = (min: number, max: number, message: string) =>
    z.string().refine((value) => {
      const parsed = Number(value.trim());
      return value.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
    }, message);

  const schema = z.object({
    days: wholeNumberIn(1, MAX_TRIAL_DAYS, interpolate(t.users.trialDaysInvalid, { max: MAX_TRIAL_DAYS })),
    aiCredits: wholeNumberIn(
      0,
      MAX_TRIAL_AI_CREDITS,
      interpolate(t.users.trialAiCreditsInvalid, { max: MAX_TRIAL_AI_CREDITS }),
    ),
  });

  const form = useForm({
    defaultValues: {
      days: String(DEFAULT_TRIAL_DAYS),
      // A running trial is pre-filled from what is left, so re-opening this and
      // pressing save does not silently reset the allowance. A lapsed one is
      // pre-filled from the default instead — re-trialling an account that ran
      // its credits down to zero and handing it zero more is never the intent.
      aiCredits: String(ended ? DEFAULT_TRIAL_AI_CREDITS : (target.trialAiCredits ?? DEFAULT_TRIAL_AI_CREDITS)),
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      try {
        await setTrial.mutateAsync({
          userId: target.id,
          action: "set",
          days: Number(value.days),
          aiCredits: Number(value.aiCredits),
        });
        await queryClient.invalidateQueries(trpc.admin.pathFilter());
        toast.success(t.users.trialSetToast);
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t.users.setTrialDescription}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3">
            <form.Field name="days">
              {(field) => {
                const error = fieldError(field.name, field.state.meta.errors);
                return (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.users.trialDays}</Label>
                    <Input
                      {...error.control}
                      inputMode="numeric"
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

            <form.Field name="aiCredits">
              {(field) => {
                const error = fieldError(field.name, field.state.meta.errors);
                return (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t.users.trialAiCredits}</Label>
                    <Input
                      {...error.control}
                      inputMode="numeric"
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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
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
