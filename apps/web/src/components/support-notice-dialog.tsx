"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "@DashboardV2/ui/components/icons";
import { useState } from "react";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { trpc } from "@/utils/trpc";

const POLL_INTERVAL_MS = 30_000;

export default function SupportNoticeDialog({ enabled }: { enabled: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const notices = useQuery({
    ...trpc.support.listNotices.queryOptions(),
    enabled,
    refetchInterval: enabled ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const dismiss = useMutation(trpc.support.dismissNotice.mutationOptions());
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissError, setDismissError] = useState<{
    noticeId: string;
    message: string;
  } | null>(null);
  const notice = notices.data?.[0];

  if (!enabled || !notice) return null;

  const actor = notice.actorName ?? t.support.supportTeam;
  const description =
    notice.kind === "support_accepted"
      ? interpolate(t.support.noticeAccepted, { actor })
      : notice.kind === "support_replied"
        ? interpolate(t.support.noticeReplied, { actor })
        : interpolate(t.support.noticeClosed, { actor });

  async function dismissCurrent() {
    if (!notice || dismissingId) return;
    const noticeId = notice.id;
    setDismissingId(noticeId);
    setDismissError(null);
    try {
      await dismiss.mutateAsync({ noticeId });
      queryClient.setQueryData(trpc.support.listNotices.queryKey(), (current) =>
        current?.filter((item) => item.id !== noticeId),
      );
      await notices.refetch();
    } catch (error) {
      const refreshed = await notices.refetch();
      if (refreshed.data?.some((item) => item.id === noticeId) ?? true) {
        setDismissError({
          noticeId,
          message: error instanceof Error ? error.message : t.support.dismissFailed,
        });
      }
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void dismissCurrent()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100svh-2rem)] flex-col overflow-hidden sm:max-w-md"
      >
        <DialogHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="size-5" />
          </div>
          <DialogTitle>{t.support.noticeTitle}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
          <div className="rounded-md border bg-card px-3 py-2.5">
            <p className="mb-1 text-xs text-muted-foreground">{t.support.subject}</p>
            <p className="break-words font-medium text-foreground">{notice.entityLabel}</p>
          </div>

          {notice.detail && (
            <div className="rounded-md bg-muted px-3 py-3">
              <p className="mb-1 font-medium text-foreground">{t.support.finalReply}</p>
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {notice.detail}
              </p>
            </div>
          )}

          {dismissError?.noticeId === notice.id && (
            <p role="alert" className="text-xs text-destructive">
              {dismissError.message}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button onClick={() => void dismissCurrent()} disabled={dismissingId !== null}>
            {dismissingId === notice.id ? t.support.dismissing : t.support.dismissNotice}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
