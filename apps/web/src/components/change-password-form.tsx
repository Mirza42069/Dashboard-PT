"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

export default function ChangePasswordForm() {
  const t = useT();
  const router = useRouter();

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
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      {fields.map(({ name, label, autoComplete }) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>{label}</Label>
              <PasswordInput
                id={field.name}
                name={field.name}
                autoComplete={autoComplete}
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
      ))}

      <form.Subscribe
        selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? t.password.updating : t.password.update}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
