"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

/**
 * The self-service entry point for a lost password. The server answers the
 * same way whether or not the address has an account, so the success copy
 * deliberately says "if" — it is not a confirmation that an email was sent.
 */
export default function ForgotPasswordDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const request = useMutation({
    ...trpc.passwordReset.request.mutationOptions(),
    gcTime: 0,
    onSuccess: () => setSent(true),
    onError: (mutError) => toast.error(mutError.message || t.auth.signInFailed),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t.auth.emailRequired);
      focusFirstInvalid(formRef.current);
      return;
    }
    setError(null);
    request.mutate({ email: trimmed });
  };

  const emailError = fieldError("forgot-email", error ? [{ message: error }] : []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSent(false);
          setEmail("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="link" size="sm" className="h-auto p-0 text-xs" />}>
        {t.auth.forgotPassword}
      </DialogTrigger>
      <DialogContent closeLabel={t.common.close}>
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.auth.forgotTitle}</DialogTitle>
              <DialogDescription>{t.auth.resetLinkSent}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>{t.common.close}</Button>
            </DialogFooter>
          </>
        ) : (
          <form
            ref={formRef}
            onSubmit={submit}
            className="space-y-4"
            noValidate
          >
            <DialogHeader>
              <DialogTitle>{t.auth.forgotTitle}</DialogTitle>
              <DialogDescription>{t.auth.forgotDescription}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor={emailError.control.id}>{t.auth.email}</Label>
              <Input
                {...emailError.control}
                name="email"
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <FieldError {...emailError} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={request.isPending} onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={request.isPending}>
                {request.isPending ? t.auth.forgotSubmitting : t.auth.forgotSubmit}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
