"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";

export default function SignInForm() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  // proxy.ts stores the page you were trying to reach here.
  const next = searchParams.get("next");

  const schema = z.object({
    email: z.email(t.auth.invalidEmail),
    password: z.string().min(1, t.auth.passwordRequired),
  });

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: () => {
            // Only same-origin paths — an attacker-supplied absolute URL in
            // ?next= would otherwise turn this into an open redirect.
            const target = next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
            router.push(target as "/dashboard");
            router.refresh();
          },
          onError: (error) => {
            // A paused (banned) account gets the subscription message, not
            // better-auth's raw "You have been banned" text.
            if (error.error.code === "BANNED_USER") {
              toast.error(t.auth.accountPaused, { duration: 8000 });
              return;
            }
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: schema,
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <h1 className="text-sm font-medium">{t.auth.signIn}</h1>
        <p className="text-xs text-muted-foreground">{t.auth.useIssuedCredentials}</p>
      </div>

      <form.Field name="email">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t.auth.email}</Label>
            <Input
              id={field.name}
              name={field.name}
              type="email"
              autoComplete="username"
              autoFocus
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

      <form.Field name="password">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>{t.auth.password}</Label>
            <PasswordInput
              id={field.name}
              name={field.name}
              autoComplete="current-password"
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

      <form.Subscribe
        selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}
      >
        {({ canSubmit, isSubmitting }) => (
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || isSubmitting}>
            {isSubmitting ? t.auth.signingIn : t.auth.signIn}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
