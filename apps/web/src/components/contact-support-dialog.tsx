"use client";

import {
  MAX_SUPPORT_SCREENSHOTS,
  isSupportScreenshotContentType,
  supportScreenshotExtension,
  supportScreenshotSelectionIssue,
} from "@DashboardV2/api/lib/support-screenshots";
import { env } from "@DashboardV2/env/web";
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@DashboardV2/ui/components/attachment";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { ImagePlus, Send, X } from "@DashboardV2/ui/components/icons";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { uploadPrivateBlob } from "@/lib/client-blob-upload";
import { getServerUrl } from "@/lib/server-url";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

type Errors = { subject?: string; message?: string; screenshots?: string };
type PendingScreenshot = { file: File; previewUrl: string };
type UploadedScreenshot = { pathname: string; filename: string };

const SCREENSHOT_ACCEPT = "image/jpeg,image/png,image/webp";

export default function ContactSupportDialog({
  open,
  onOpenChange,
  currentUserId,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUserId: string;
  /** Receives the new request's id, so the caller can open the thread on it. */
  onSubmitted?: (id: string) => void;
}) {
  const t = useT();
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef(new Set<string>());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = useMutation(trpc.support.submit.mutationOptions());
  const discard = useMutation(trpc.support.discardScreenshots.mutationOptions());

  useEffect(() => {
    return () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    };
  }, []);

  function clearScreenshots() {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
    setScreenshots([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function reset() {
    setSubject("");
    setMessage("");
    clearScreenshots();
    setErrors({});
    setSubmitError(null);
    setBusy(false);
  }

  function setOpen(next: boolean) {
    if (!next && busy) return;
    if (!next) reset();
    onOpenChange(next);
  }

  function addScreenshots(files: FileList | null) {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    const issue = supportScreenshotSelectionIssue(
      [...screenshots.map(({ file }) => file), ...selected].map((file) => ({
        size: file.size,
        contentType: file.type,
      })),
    );
    if (issue) {
      const message =
        issue === "too-many"
          ? t.support.screenshotTooMany
          : issue === "too-large"
            ? t.support.screenshotTooLarge
            : t.support.screenshotTypeUnsupported;
      setErrors((value) => ({ ...value, screenshots: message }));
      return;
    }

    const pending = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return { file, previewUrl };
    });
    setScreenshots((current) => [...current, ...pending]);
    setErrors((value) => ({ ...value, screenshots: undefined }));
  }

  function removeScreenshot(index: number) {
    setScreenshots((current) => {
      const removed = current[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setErrors((value) => ({ ...value, screenshots: undefined }));
  }

  async function discardUploaded(items: UploadedScreenshot[]) {
    if (items.length === 0) return;
    await discard
      .mutateAsync({ pathnames: items.map(({ pathname }) => pathname) })
      .catch(() => undefined);
  }

  async function uploadScreenshots(): Promise<UploadedScreenshot[]> {
    const handleUploadUrl = `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/support/screenshots/upload`;
    const results = await Promise.allSettled(
      screenshots.map(async ({ file }) => {
        if (!isSupportScreenshotContentType(file.type)) {
          throw new Error(t.support.screenshotTypeUnsupported);
        }
        const pathname = `support-screenshots/${currentUserId}/${crypto.randomUUID()}.${supportScreenshotExtension(file.type)}`;
        const blob = await uploadPrivateBlob({
          pathname,
          file,
          handleUploadUrl,
          contentType: file.type,
          multipart: true,
        });
        return { pathname: blob.pathname, filename: file.name };
      }),
    );
    const uploaded = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      await discardUploaded(uploaded);
      throw failure.reason;
    }
    return uploaded;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    const nextErrors: Errors = {};

    if (!cleanSubject) nextErrors.subject = t.support.subjectRequired;
    else if (cleanSubject.length > 200) nextErrors.subject = t.support.subjectTooLong;
    if (!cleanMessage) nextErrors.message = t.support.messageRequired;
    else if (cleanMessage.length > 10_000) nextErrors.message = t.support.messageTooLong;

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

    setBusy(true);
    let uploaded: UploadedScreenshot[] = [];
    try {
      uploaded = await uploadScreenshots();
      const created = await submit.mutateAsync({
        subject: cleanSubject,
        message: cleanMessage,
        screenshots: uploaded,
      });
      reset();
      onOpenChange(false);
      toast.success(t.support.requestSent);
      onSubmitted?.(created.id);
    } catch (error) {
      await discardUploaded(uploaded);
      setSubmitError(error instanceof Error ? error.message : t.support.submitFailed);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        closeLabel={t.common.close}
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <form className="space-y-4" onSubmit={handleSubmit} aria-busy={busy} noValidate>
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

          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={SCREENSHOT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                addScreenshots(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || screenshots.length >= MAX_SUPPORT_SCREENSHOTS}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus />
                {t.support.addScreenshots}
              </Button>
              <span className="text-xs text-muted-foreground">{t.support.screenshotHint}</span>
            </div>
            {screenshots.length > 0 && (
              <AttachmentGroup aria-label={t.support.addScreenshots}>
                {screenshots.map((item, index) => (
                  <Attachment
                    key={item.previewUrl}
                    orientation="vertical"
                    state={busy ? "uploading" : "done"}
                  >
                    <AttachmentMedia variant="image">
                      {/* Local object URLs cannot be optimized by next/image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.previewUrl} alt="" />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{item.file.name}</AttachmentTitle>
                    </AttachmentContent>
                    {!busy && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="absolute top-1 right-1 z-20 bg-background/80"
                        aria-label={interpolate(t.support.removeScreenshot, {
                          name: item.file.name,
                        })}
                        onClick={() => removeScreenshot(index)}
                      >
                        <X />
                      </Button>
                    )}
                  </Attachment>
                ))}
              </AttachmentGroup>
            )}
            {errors.screenshots && (
              <p role="alert" className="text-xs text-destructive">
                {errors.screenshots}
              </p>
            )}
          </div>

          {submitError && (
            <p role="alert" className="text-xs text-destructive">
              {submitError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              <Send />
              {busy
                ? screenshots.length > 0
                  ? t.support.uploadingScreenshots
                  : t.support.sending
                : t.support.sendRequest}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
