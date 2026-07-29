"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";
import z from "zod";

import { FieldError, fieldError, focusFirstInvalid } from "@/components/field-error";
import { PasswordInput } from "@/components/password-input";
import { useT } from "@/i18n/provider";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

export default function SignInForm() {
  const t = useT();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
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
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Validation is async, so the aria-invalid attributes this reads do not
        // exist until React has re-rendered with the results.
        void form.handleSubmit().then(() => focusFirstInvalid(formRef.current));
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1">
        <h1 className="text-sm font-medium">{t.auth.signIn}</h1>
        <p className="text-xs text-muted-foreground">{t.auth.useIssuedCredentials}</p>
      </div>

      <form.Field name="email">
        {(field) => {
          const error = fieldError(field.name, field.state.meta.errors);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>{t.auth.email}</Label>
              <Input
                {...error.control}
                name={field.name}
                type="email"
                autoComplete="username"
                autoFocus
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError {...error} />
            </div>
          );
        }}
      </form.Field>

      <form.Field name="password">
        {(field) => {
          const error = fieldError(field.name, field.state.meta.errors);
          return (
            <div className="space-y-2">
              <Label htmlFor={field.name}>{t.auth.password}</Label>
              <PasswordInput
                {...error.control}
                name={field.name}
                autoComplete="current-password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError {...error} />
            </div>
          );
        }}
      </form.Field>

      {/*
        Disabled only while the request is in flight, not on `!canSubmit`.
        Validation here runs `onSubmit` only, so after one failed attempt
        canSubmit stays false until the form revalidates — and the only thing
        that revalidates it is a submit, which the disabled button prevents.
        Correcting the email left the user pressing a dead control with no
        explanation. Keeping submit live also matches how the errors now
        announce: press, hear what is wrong, fix it, press again.
      */}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t.auth.signingIn : t.auth.signIn}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
