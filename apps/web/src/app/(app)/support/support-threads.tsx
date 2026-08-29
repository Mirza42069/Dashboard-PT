"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Send } from "@DashboardV2/ui/components/icons";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import ContactSupportDialog from "@/components/contact-support-dialog";
import { QueryError } from "@/components/query-error";
import { SupportTranscript } from "@/components/support-transcript";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * Faster than the 30s the inbox and the nav badge use. This is the one place
 * somebody is sitting and waiting for a reply to appear, so the cost of an extra
 * request buys something here that it does not buy on a list.
 */
const THREAD_POLL_MS = 10_000;

/**
 * The requester's side of support: their conversations, and the composer.
 *
 * A list beside a thread rather than a route per request. The list is capped at
 * 100 by the procedure and most people will have a handful, so paginating it
 * would add a control that never earns its place — and keeping the thread in the
 * same view means sending a message does not navigate.
 */
export default function SupportThreads({ currentUserId }: { currentUserId: string }) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const listQuery = useQuery({
    ...trpc.support.myRequests.queryOptions(),
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const requests = listQuery.data ?? [];

  // Falls back to the newest thread so the pane is never blank on arrival, and
  // recovers if the selected request disappears.
  const activeId =
    selectedId && requests.some((row) => row.id === selectedId)
      ? selectedId
      : (requests[0]?.id ?? null);

  const threadQuery = useQuery({
    ...trpc.support.myThread.queryOptions({ id: activeId ?? "" }),
    enabled: activeId !== null,
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });

  const postMessage = useMutation(trpc.support.postMessage.mutationOptions());
  const markRead = useMutation(trpc.support.markThreadRead.mutationOptions());

  const thread = threadQuery.data;
  const closed = thread?.request.status === "closed";
  const unreadHere = requests.find((row) => row.id === activeId)?.unread ?? 0;

  /**
   * Opening a thread is what clears its badge. Keyed on the unread count as well
   * as the id, so a reply that lands while the thread is already open clears too
   * rather than sitting there until the reader navigates away and back.
   */
  useEffect(() => {
    if (!activeId || unreadHere === 0) return;
    void markRead
      .mutateAsync({ id: activeId })
      .then(() => queryClient.invalidateQueries(trpc.support.pathFilter()))
      .catch(() => undefined);
    // markRead and queryClient are stable; re-running on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, unreadHere]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!activeId) return;
    if (!body) {
      toast.error(t.support.messageRequired);
      composerRef.current?.focus();
      return;
    }
    try {
      await postMessage.mutateAsync({ id: activeId, body });
      setDraft("");
      await queryClient.invalidateQueries(trpc.support.pathFilter());
      composerRef.current?.focus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.support.messageFailed);
    }
  }

  if (listQuery.isError) {
    return (
      <QueryError error={listQuery.error} onRetry={() => void listQuery.refetch()} />
    );
  }

  return (
    <>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Request list */}
        <Card className="flex min-h-0 flex-col">
          <CardContent className="flex min-h-0 flex-col gap-2 p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setComposeOpen(true)}
            >
              {t.support.newRequest}
            </Button>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {listQuery.isPending && (
                <div className="space-y-2 p-1" aria-label={t.support.loadingRequests}>
                  {Array.from({ length: 4 }, (_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              )}

              {!listQuery.isPending && requests.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <p className="font-medium text-foreground">{t.support.emptyRequestList}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t.support.emptyRequestHint}
                  </p>
                </div>
              )}

              <ul>
                {requests.map((row) => {
                  const isActive = row.id === activeId;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(row.id)}
                        aria-current={isActive ? "true" : undefined}
                        className={cn(
                          "w-full rounded-md px-3 py-2 text-left transition-colors",
                          isActive ? "bg-muted" : "hover:bg-muted/60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {row.subject}
                          </span>
                          {row.unread > 0 && (
                            <span className="mt-0.5 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[0.6875rem] leading-none font-medium text-primary-foreground tabular-nums">
                              {row.unread}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {t.support.status[row.status]} ·{" "}
                          {formatDateTime(row.updatedAt)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardContent>
        </Card>

        {/* Thread */}
        <Card className="flex min-h-0 flex-col">
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 p-0">
            {activeId === null && !listQuery.isPending && (
              <p className="p-8 text-center text-muted-foreground">{t.support.selectRequest}</p>
            )}

            {threadQuery.isError && (
              <QueryError
                error={threadQuery.error}
                onRetry={() => void threadQuery.refetch()}
                className="m-4 border-0"
              />
            )}

            {activeId !== null && threadQuery.isPending && (
              <div className="space-y-4 p-4" aria-label={t.support.loadingRequest}>
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-16 w-full" />
                ))}
              </div>
            )}

            {thread && (
              <>
                <div className="border-b px-4 py-3">
                  <p className="font-semibold text-foreground">{thread.request.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {closed
                      ? t.support.status.closed
                      : thread.request.status === "answered"
                        ? t.support.awaitingYou
                        : t.support.awaitingSupport}
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4">
                  <SupportTranscript
                    opening={{
                      body: thread.request.message,
                      authorName: thread.request.requesterName,
                      createdAt: thread.request.createdAt,
                      attachments: thread.request.attachments,
                    }}
                    messages={thread.messages}
                    mine="requester"
                  />
                </div>

                {closed ? (
                  <div className="border-t px-4 py-4 text-center">
                    <p className="text-sm text-muted-foreground">{t.support.threadClosed}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t.support.threadClosedHint}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setComposeOpen(true)}
                    >
                      {t.support.newRequest}
                    </Button>
                  </div>
                ) : (
                  <form className="flex items-end gap-2 border-t px-4 py-3" onSubmit={send}>
                    <Textarea
                      ref={composerRef}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder={t.support.composerPlaceholder}
                      aria-label={t.support.composerPlaceholder}
                      rows={2}
                      maxLength={10_000}
                      className="min-h-0 flex-1 resize-none"
                    />
                    <Button type="submit" size="sm" disabled={postMessage.isPending}>
                      <Send />
                      {postMessage.isPending ? t.support.messageSending : t.support.sendMessage}
                    </Button>
                  </form>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ContactSupportDialog
        currentUserId={currentUserId}
        open={composeOpen}
        onOpenChange={setComposeOpen}
        onSubmitted={(id) => {
          setSelectedId(id);
          void queryClient.invalidateQueries(trpc.support.pathFilter());
        }}
      />
    </>
  );
}
