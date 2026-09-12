"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Label } from "@DashboardV2/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

export default function ResetPasswordForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ newPassword?: string; confirm?: string; form?: string }>({});
  const formRef = useRef<HTMLFormElement>(null);

  const reset = useMutation({
    ...trpc.passwordReset.reset.mutationOptions(),
    gcTime: 0,
    onSuccess: () => {
      // Every session died with the old credential, so sign-in is the only way
      // back in — send them there with the reason on screen.
      toast.success(t.password.resetDone, { duration: 8000 });
      router.push("/login");
    },
    onError: (error) => setErrors({ form: error.message || t.password.updateFailed }),
  });

  const schema = z.object({
    newPassword: z.string().min(12, t.password.minLength).max(128, t.password.maxLength),
    confirm: z.string().min(1, t.password.confirmRequired),
  }).refine((value) => value.newPassword === value.confirm, {
    message: t.password.mismatch,
    path: ["confirm"],
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = schema.safeParse({ newPassword, confirm });
    if (!parsed.success) {
      const messages: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof typeof messages;
        messages[key] ??= issue.message;
      }
      setErrors(messages);
      void Promise.resolve().then(() => focusFirstInvalid(formRef.current));
      return;
    }
    setErrors({});
    reset.mutate({ token, newPassword });
  };

  // A missing or blank token renders the same "invalid link" state as a spent
  // one — the URL is never worth explaining in detail.
  if (!token) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle as="h1">{t.password.resetTitle}</CardTitle>
          <CardDescription>{t.password.resetLinkInvalid}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const newPasswordError = fieldError("reset-new-password", errors.newPassword ? [{ message: errors.newPassword }] : []);
  const confirmError = fieldError("reset-confirm", errors.confirm ? [{ message: errors.confirm }] : []);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        {/* Bare page: this card title is the document's only heading. */}
        <CardTitle as="h1">{t.password.resetTitle}</CardTitle>
        <CardDescription>{t.password.resetDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          onSubmit={submit}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor={newPasswordError.control.id}>{t.password.new}</Label>
            <PasswordInput
              {...newPasswordError.control}
              name="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <FieldError {...newPasswordError} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={confirmError.control.id}>{t.password.confirm}</Label>
            <PasswordInput
              {...confirmError.control}
              name="confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
            <FieldError {...confirmError} />
          </div>
          {errors.form && <p className="text-xs text-destructive">{errors.form}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={reset.isPending}>
            {reset.isPending ? t.password.resetting : t.password.reset}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
