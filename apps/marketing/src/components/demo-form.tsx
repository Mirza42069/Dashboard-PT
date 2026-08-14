"use client";

import { useActionState } from "react";

import type { Content } from "@/lib/content";
import type { DemoFormState } from "@/lib/demo-form";

import { ArrowRight } from "./icons";

const initialState: DemoFormState = { status: "idle", message: "", errors: {} };

export function DemoForm({
  t,
  action,
  configured,
}: {
  t: Content;
  action: (state: DemoFormState, data: FormData) => Promise<DemoFormState>;
  configured: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const error = (name: keyof DemoFormState["errors"]) => state.errors[name];

  return (
    <form action={formAction} className="demo-form" noValidate aria-busy={pending}>
      <input type="hidden" name="locale" value={t.locale} />
      <div className="honeypot" aria-hidden>
        <label htmlFor={`website-${t.locale}`}>Website</label>
        <input id={`website-${t.locale}`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="form-grid">
        <Field label={t.demo.fields.name} name="name" error={error("name")} autoComplete="name" />
        <Field label={t.demo.fields.company} name="company" error={error("company")} autoComplete="organization" />
        <Field label={t.demo.fields.email} name="email" type="email" error={error("email")} autoComplete="work email" />
        <Field label={t.demo.fields.role} name="role" error={error("role")} autoComplete="organization-title" />
        <Field label={t.demo.fields.size} name="size" error={error("size")} inputMode="numeric" />
      </div>
      <div className="field-group">
        <label htmlFor={`challenge-${t.locale}`}>{t.demo.fields.challenge}</label>
        <textarea
          id={`challenge-${t.locale}`}
          name="challenge"
          rows={5}
          maxLength={2000}
          placeholder={t.demo.fields.challengePlaceholder}
          aria-invalid={Boolean(error("challenge")) || undefined}
          aria-describedby={error("challenge") ? `challenge-${t.locale}-error` : undefined}
        />
        {error("challenge") && <p id={`challenge-${t.locale}-error`} className="field-error">{error("challenge")}</p>}
      </div>
      {!configured && <p className="form-unavailable">{t.demo.unavailable}</p>}
      {state.message && (
        <p className="form-status" role={state.status === "error" ? "alert" : "status"} data-status={state.status}>
          {state.message}
        </p>
      )}
      <div className="form-footer">
        <p>{t.demo.privacy}</p>
        <button type="submit" className="button button-cobalt" disabled={pending || !configured}>
          {pending ? t.demo.fields.submitting : t.demo.fields.submit}<ArrowRight />
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  error,
  type = "text",
  autoComplete,
  inputMode,
}: {
  label: string;
  name: string;
  error?: string;
  type?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  const id = `demo-${name}`;
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        maxLength={name === "email" ? 254 : 120}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && <p id={`${id}-error`} className="field-error">{error}</p>}
    </div>
  );
}
