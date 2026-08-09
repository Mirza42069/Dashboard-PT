"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export default function ChangePasswordForm() {
  const t = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const schema = z
    .object({
      currentPassword: z.string().min(1, t.password.currentRequired),
      newPassword: z.string().min(12, t.password.minLength),
      confirmPassword: z.string().min(1, t.password.confirmRequired),
    })
    .refine((value) => value.newPassword === value.confirmPassword, {
      message: t.password.mismatch,
      path: ["confirmPassword"],
    })
    .refine((value) => value.newPassword !== value.currentPassword, {
      message: t.password.mustDiffer,
      path: ["newPassword"],
    });

  const changePassword = useMutation(
    trpc.account.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success(t.password.updated);
        router.push("/dashboard");
        router.refresh();
      },
      onError: (error) => {
        toast.error(error.message);
      },
    }),
  );

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      await changePassword.mutateAsync({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
      });
    },
    validators: {
      onSubmit: schema,
    },
  });

  const fields = [
    { name: "currentPassword", label: t.password.current, autoComplete: "current-password" },
    { name: "newPassword", label: t.password.new, autoComplete: "new-password" },
    { name: "confirmPassword", label: t.password.confirm, autoComplete: "new-password" },
  ] as const;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-4">
        {fields.map(({ name, label, autoComplete }) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const error = fieldError(field.name, field.state.meta.errors);
              return (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{label}</Label>
                  <PasswordInput
                    {...error.control}
                    name={field.name}
                    autoComplete={autoComplete}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError {...error} />
                </div>
              );
            }}
          </form.Field>
        ))}
      </div>

      <form.Subscribe
        selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? t.password.updating : t.password.update}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
