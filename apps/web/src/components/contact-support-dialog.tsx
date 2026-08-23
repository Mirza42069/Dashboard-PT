"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
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
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { Send } from "@DashboardV2/ui/components/icons";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

type Errors = { subject?: string; message?: string };

export default function ContactSupportDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the new request's id, so the caller can open the thread on it. */
  onSubmitted?: (id: string) => void;
}) {
  const t = useT();
  const pathname = usePathname();
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includePage, setIncludePage] = useState(true);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submit = useMutation(trpc.support.submit.mutationOptions());

  function reset() {
    setSubject("");
    setMessage("");
    setIncludePage(true);
    setErrors({});
    setSubmitError(null);
  }

  function setOpen(next: boolean) {
    if (!next && submit.isPending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    const pageSuffix = includePage && pathname ? `\n\n[Current page] ${pathname}` : "";
    const nextErrors: Errors = {};

    if (!cleanSubject) nextErrors.subject = t.support.subjectRequired;
    else if (cleanSubject.length > 200) nextErrors.subject = t.support.subjectTooLong;
    if (!cleanMessage) nextErrors.message = t.support.messageRequired;
    else if (cleanMessage.length + pageSuffix.length > 10_000) {
      nextErrors.message = t.support.messageTooLong;
    }

    setErrors(nextErrors);
    setSubmitError(null);
    if (nextErrors.subject) {
      subjectRef.current?.focus();
      return;
    }
    if (nextErrors.message) {
      messageRef.current?.focus();
      return;
    }

    try {
      const created = await submit.mutateAsync({
        subject: cleanSubject,
        message: `${cleanMessage}${pageSuffix}`,
      });
      reset();
      onOpenChange(false);
      toast.success(t.support.requestSent);
      onSubmitted?.(created.id);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t.support.submitFailed);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        closeLabel={t.common.close}
        showCloseButton={!submit.isPending}
        className="sm:max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={handleSubmit}
          aria-busy={submit.isPending}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{t.support.contactSupport}</DialogTitle>
            <DialogDescription>{t.support.contactDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="support-subject">{t.support.subject}</Label>
            <Input
              ref={subjectRef}
              id="support-subject"
              name="subject"
              value={subject}
              maxLength={201}
              aria-invalid={Boolean(errors.subject)}
              aria-describedby={errors.subject ? "support-subject-error" : undefined}
              onChange={(event) => {
                setSubject(event.target.value);
                if (errors.subject) setErrors((value) => ({ ...value, subject: undefined }));
              }}
              placeholder={t.support.subjectPlaceholder}
            />
            {errors.subject && (
              <p id="support-subject-error" className="text-xs text-destructive">
                {errors.subject}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-message">{t.support.message}</Label>
            <Textarea
              ref={messageRef}
              id="support-message"
              name="message"
              value={message}
              className="min-h-32"
              maxLength={10_000}
              aria-invalid={Boolean(errors.message)}
              aria-describedby={errors.message ? "support-message-error" : undefined}
              onChange={(event) => {
                setMessage(event.target.value);
                if (errors.message) setErrors((value) => ({ ...value, message: undefined }));
              }}
              placeholder={t.support.messagePlaceholder}
            />
            {errors.message && (
              <p id="support-message-error" className="text-xs text-destructive">
                {errors.message}
              </p>
            )}
          </div>

          {pathname && (
            <div className="flex items-start gap-3 rounded-md bg-muted/60 px-3 py-2.5">
              <Checkbox
                id="support-include-page"
                checked={includePage}
                onCheckedChange={setIncludePage}
                className="mt-0.5"
              />
              <Label htmlFor="support-include-page" className="min-w-0 cursor-pointer font-normal">
                <span className="block">{t.support.includeCurrentPage}</span>
                <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                  {pathname}
                </span>
              </Label>
            </div>
          )}

          {submitError && (
            <p role="alert" className="text-xs text-destructive">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submit.isPending}
              onClick={() => setOpen(false)}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={submit.isPending}>
              <Send />
              {submit.isPending ? t.support.sending : t.support.sendRequest}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
