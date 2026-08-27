"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

export default function SetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    window.history.replaceState(null, "", "/set-password");
  }, []);
  const schema = z
    .object({
      newPassword: z.string().min(12, t.password.minLength),
      confirmPassword: z.string().min(1, t.password.confirmRequired),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: t.password.mismatch,
      path: ["confirmPassword"],
    });

  const form = useForm({
    defaultValues: { newPassword: "", confirmPassword: "" },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      await authClient.resetPassword(
        { newPassword: value.newPassword, token },
        {
          onSuccess: () => {
            toast.success(t.password.setupComplete);
            router.replace("/login");
            router.refresh();
          },
          onError: () => {
            toast.error(t.password.setupFailed);
          },
        },
      );
    },
  });

  return (
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
      <form.Field name="newPassword">
        {(field) => {
          const error = fieldError(field.name, field.state.meta.errors);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>{t.password.new}</Label>
              <PasswordInput
                {...error.control}
                autoComplete="new-password"
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

      <form.Field name="confirmPassword">
        {(field) => {
          const error = fieldError(field.name, field.state.meta.errors);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>{t.password.confirm}</Label>
              <PasswordInput
                {...error.control}
                autoComplete="new-password"
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

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t.password.settingUp : t.password.setupAction}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
