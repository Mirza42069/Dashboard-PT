"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Label } from "@DashboardV2/ui/components/label";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

/**
 * `horizontal` lays the three fields across one row. Used in Settings, where
 * the tile is full-width and a narrow stacked column would leave most of it
 * empty; the standalone /change-password page keeps the default single column.
 */
export default function ChangePasswordForm({ horizontal = false }: { horizontal?: boolean }) {
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
      <div className={cn("gap-4", horizontal ? "grid sm:grid-cols-3" : "space-y-4")}>
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
      </div>

      <form.Subscribe
        selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button
            type="submit"
            size="lg"
            className={cn(horizontal ? "w-full sm:w-auto" : "w-full")}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? t.password.updating : t.password.update}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
