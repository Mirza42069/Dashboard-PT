"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Avatar, AvatarFallback } from "@DashboardV2/ui/components/avatar";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@DashboardV2/ui/components/empty";
import {
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Inbox,
  Loader2,
  SearchX,
  Send,
  Trash2,
} from "@DashboardV2/ui/components/icons";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { cn } from "@DashboardV2/ui/lib/utils";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";

import { QueryError } from "@/components/query-error";
import { SupportTranscript } from "@/components/support-transcript";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 30_000;
const THREAD_POLL_MS = 10_000;
const STATUSES = ["new", "accepted", "answered", "closed"] as const;
type SupportStatus = (typeof STATUSES)[number];
type SupportRequest = inferOutput<typeof trpc.support.list>["requests"][number];

function statusClass(status: SupportStatus) {
  if (status === "new") {
    return "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  }
  if (status === "accepted") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (status === "answered") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "?";
}

export default function SupportInbox() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState<"all" | SupportStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const statusItems = [
    { value: "all", label: t.support.allStatuses },
    ...STATUSES.map((value) => ({ value, label: t.support.status[value] })),
  ];

  const inbox = useInfiniteQuery(
    trpc.support.list.infiniteQueryOptions(
      {
        limit: PAGE_SIZE,
        status: status === "all" ? undefined : status,
        search: debouncedSearch,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        refetchInterval: POLL_INTERVAL_MS,
        refetchIntervalInBackground: false,
      },
    ),
  );

  const requests = inbox.data?.pages.flatMap((page) => page.requests) ?? [];
  const hasSearch = Boolean(debouncedSearch.trim());
  const hasFilters = Boolean(search.trim()) || status !== "all";
  const initialError = inbox.isError && inbox.data === undefined;

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !inbox.hasNextPage || inbox.isFetchNextPageError) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !inbox.isFetchingNextPage) void inbox.fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    inbox.hasNextPage,
    inbox.isFetchingNextPage,
    inbox.isFetchNextPageError,
    inbox.fetchNextPage,
  ]);

  function backToList() {
    const previousId = selectedId;
    setSelectedId(null);
    requestAnimationFrame(() => document.getElementById(`support-request-${previousId}`)?.focus());
  }

  return (
    <div className="grid min-h-0 flex-1 overflow-hidden bg-card md:rounded-xl md:border md:shadow-sm lg:grid-cols-[21rem_minmax(0,1fr)]">
      <section
        aria-label={t.support.requestList}
        className={cn(
          "min-h-0 flex-col border-e bg-card",
          selectedId ? "hidden lg:flex" : "flex",
        )}
      >
        <div className="space-y-2 border-b p-3">
          <h1 className="px-1 text-lg font-semibold tracking-tight">{t.support.inboxTitle}</h1>
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
            placeholder={t.support.searchPlaceholder}
            aria-label={t.support.searchLabel}
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="support-status" className="sr-only">
              {t.support.filterStatus}
            </Label>
            <Select
              items={statusItems}
              value={status}
              onValueChange={(value) => setStatus((value ?? "all") as "all" | SupportStatus)}
            >
              <SelectTrigger id="support-status" className="min-w-0 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                }}
              >
                {t.common.clearFilters}
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {inbox.isPending && (
            <div className="space-y-1 p-2" role="status" aria-label={t.support.loadingInbox}>
              {Array.from({ length: 7 }, (_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          )}

          {initialError && (
            <QueryError error={inbox.error} onRetry={() => void inbox.refetch()} className="m-3" />
          )}

          {!inbox.isPending && !initialError && requests.length === 0 && (
            <Empty className="min-h-64 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {hasSearch || status !== "all" ? <SearchX /> : <Inbox />}
                </EmptyMedia>
                <EmptyTitle>
                  {hasSearch || status !== "all" ? t.support.noMatches : t.support.emptyInbox}
                </EmptyTitle>
              </EmptyHeader>
              {(hasSearch || status !== "all") && (
                <EmptyContent>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setStatus("all");
                    }}
                  >
                    {t.common.clearFilters}
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}

          {!initialError && requests.length > 0 && (
            <ul className="divide-y">
              {requests.map((request) => (
                <li key={request.id}>
                  <RequestRow
                    request={request}
                    selected={selectedId === request.id}
                    formatDateTime={formatDateTime}
                    onOpen={() => setSelectedId(request.id)}
                  />
                </li>
              ))}
            </ul>
          )}

          {inbox.isFetchNextPageError && (
            <QueryError
              error={inbox.error}
              onRetry={() => void inbox.fetchNextPage()}
              className="m-3"
            />
          )}

          {!initialError && !inbox.isFetchNextPageError && inbox.hasNextPage && (
            <div ref={loadMoreRef} className="flex min-h-12 items-center justify-center" aria-live="polite">
              {inbox.isFetchingNextPage && (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" />
                  {t.support.loadingMore}
                </span>
              )}
            </div>
          )}

          {!inbox.isPending && !initialError && !inbox.hasNextPage && requests.length > 0 && (
            <p role="status" className="px-3 py-4 text-center text-xs text-muted-foreground">
              {hasSearch
                ? interpolate(t.support.searchComplete, { count: requests.length })
                : t.support.endOfInbox}
            </p>
          )}
        </div>
      </section>

      <section
        aria-label={t.support.conversation}
        className={cn("min-h-0 min-w-0 flex-col bg-muted/20", selectedId ? "flex" : "hidden lg:flex")}
      >
        {selectedId ? (
          <RequestChat
            selectedId={selectedId}
            onBack={backToList}
            onDeleted={() => setSelectedId(null)}
          />
        ) : (
          <Empty className="flex-1 border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>{t.support.selectConversation}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  );
}

function RequestRow({
  request,
  selected,
  formatDateTime,
  onOpen,
}: {
  request: SupportRequest;
  selected: boolean;
  formatDateTime: (value: string | Date | null | undefined) => string;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button
      id={`support-request-${request.id}`}
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full gap-3 p-3 text-start outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-muted",
      )}
    >
      <Avatar size="lg" className="mt-0.5">
        <AvatarFallback>{initials(request.requesterName)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">
            {request.requesterName}
          </span>
          <time className="shrink-0 text-[0.6875rem] text-muted-foreground" dateTime={new Date(request.updatedAt).toISOString()}>
            {formatDateTime(request.updatedAt)}
          </time>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground">{request.subject}</span>
          <Badge variant="outline" className={cn("shrink-0 px-1.5 py-0 text-[0.625rem]", statusClass(request.status))}>
            {t.support.status[request.status]}
          </Badge>
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {request.companyName} · {request.message}
        </span>
      </span>
    </button>
  );
}

function RequestChat({
  selectedId,
  onBack,
  onDeleted,
}: {
  selectedId: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const detail = useQuery({
    ...trpc.support.get.queryOptions({ id: selectedId }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const thread = useQuery({
    ...trpc.support.thread.queryOptions({ id: selectedId }),
    refetchInterval: THREAD_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const accept = useMutation(trpc.support.accept.mutationOptions());
  const sendReply = useMutation(trpc.support.reply.mutationOptions());
  const close = useMutation(trpc.support.close.mutationOptions());
  const deleteRequestMutation = useMutation(trpc.support.delete.mutationOptions());
  const request = detail.data;
  const actionPending =
    accept.isPending || sendReply.isPending || close.isPending || deleteRequestMutation.isPending;

  useEffect(() => {
    setReply("");
    setReplyError(null);
    setActionError(null);
  }, [selectedId]);

  useEffect(() => {
    if (!request) return;
    headingRef.current?.focus();
    if (request.status === "accepted" && window.matchMedia("(min-width: 64rem)").matches) {
      replyRef.current?.focus();
    }
  }, [request?.id, request?.status]);

  async function refresh() {
    await queryClient.invalidateQueries(trpc.support.pathFilter());
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setActionError(null);
    try {
      await action();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.support.actionFailed);
      return false;
    }
  }

  async function handleReply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanReply = reply.trim();
    if (!cleanReply) {
      setReplyError(t.support.replyRequired);
      replyRef.current?.focus();
      return;
    }
    if (cleanReply.length > 10_000) {
      setReplyError(t.support.replyTooLong);
      replyRef.current?.focus();
      return;
    }
    const succeeded = await run(
      () => sendReply.mutateAsync({ id: selectedId, reply: cleanReply }),
      t.support.replySent,
    );
    if (succeeded) {
      setReply("");
      replyRef.current?.focus();
    }
  }

  async function deleteRequest() {
    if (!request) return;
    setDeleteError(null);
    try {
      await deleteRequestMutation.mutateAsync({ id: request.id });
      await refresh();
      setDeleteOpen(false);
      toast.success(t.support.requestDeleted);
      onDeleted();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t.support.deleteRequestFailed);
    }
  }

  if (detail.isPending) {
    return (
      <div className="flex min-h-0 flex-1 flex-col" role="status" aria-label={t.support.loadingRequest}>
        <div className="flex items-center gap-3 border-b bg-card p-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            aria-label={t.support.backToConversations}
            onClick={onBack}
          >
            <ArrowLeft />
          </Button>
          <Skeleton className="size-10 rounded-full" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="space-y-4 p-6">
          <Skeleton className="h-20 w-2/3" />
          <Skeleton className="ms-auto h-20 w-2/3" />
        </div>
      </div>
    );
  }

  if (detail.isError || !request) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b bg-card p-2 lg:hidden">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft />
            {t.support.backToConversations}
          </Button>
        </div>
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} className="m-4" />
      </div>
    );
  }

  return (
    <>
      <header className="flex min-w-0 items-center gap-3 border-b bg-card px-3 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          aria-label={t.support.backToConversations}
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <Avatar size="lg">
          <AvatarFallback>{initials(request.requesterName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 ref={headingRef} tabIndex={-1} className="truncate text-sm font-semibold outline-none">
            {request.requesterName}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {request.companyName} ({request.companyCode}) · {request.subject}
          </p>
        </div>
        <Badge variant="outline" className={cn("hidden sm:inline-flex", statusClass(request.status))}>
          {t.support.status[request.status]}
        </Badge>
        {(request.status === "accepted" || request.status === "answered") && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="sm:hidden"
            aria-label={t.support.closeRequest}
            disabled={actionPending}
            onClick={() =>
              void run(
                () => close.mutateAsync({ id: request.id }),
                t.support.requestClosed,
              )
            }
          >
            {close.isPending ? <Loader2 className="animate-spin" /> : <CircleSlash />}
          </Button>
        )}
        {(request.status === "accepted" || request.status === "answered") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden sm:inline-flex"
            disabled={actionPending}
            onClick={() =>
              void run(
                () => close.mutateAsync({ id: request.id }),
                t.support.requestClosed,
              )
            }
          >
            {close.isPending ? t.support.closing : t.support.closeRequest}
          </Button>
        )}
        {request.status === "closed" && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={actionPending}
            aria-label={t.support.deleteRequest}
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            <Trash2 />
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5 sm:px-6">
        {thread.isError ? (
          <QueryError error={thread.error} onRetry={() => void thread.refetch()} />
        ) : thread.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-2/3" />
            <Skeleton className="ms-auto h-20 w-2/3" />
          </div>
        ) : (
          <SupportTranscript
            opening={{
              body: request.message,
              authorName: request.requesterName,
              createdAt: request.createdAt,
              attachments: request.attachments,
            }}
            messages={thread.data}
            events={[
              ...(request.acceptedAt
                ? [
                    {
                      id: "accepted",
                      createdAt: request.acceptedAt,
                      label: interpolate(t.support.acceptedBy, {
                        actor: request.acceptedByName ?? t.support.supportTeam,
                        date: formatDateTime(request.acceptedAt),
                      }),
                    },
                  ]
                : []),
              ...(request.closedAt
                ? [
                    {
                      id: "closed",
                      createdAt: request.closedAt,
                      label: interpolate(t.support.closedBy, {
                        actor: request.closedByName ?? t.support.supportTeam,
                        date: formatDateTime(request.closedAt),
                      }),
                    },
                  ]
                : []),
            ]}
            mine="support"
          />
        )}
      </div>

      {actionError && (
        <p role="alert" className="border-t bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {actionError}
        </p>
      )}

      {request.status === "new" && (
        <div className="flex items-center justify-between gap-3 border-t bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">{t.support.status.new}</p>
          <Button
            type="button"
            disabled={actionPending}
            onClick={() =>
              void run(
                () => accept.mutateAsync({ id: request.id }),
                t.support.requestAccepted,
              )
            }
          >
            <CheckCircle2 />
            {accept.isPending ? t.support.accepting : t.support.acceptRequest}
          </Button>
        </div>
      )}

      {(request.status === "accepted" || request.status === "answered") && (
        <form className="border-t bg-card p-3" onSubmit={handleReply} aria-busy={sendReply.isPending} noValidate>
          <Label htmlFor="support-chat-reply" className="sr-only">
            {t.support.finalReply}
          </Label>
          <div className="flex items-end gap-2">
            <Textarea
              ref={replyRef}
              id="support-chat-reply"
              value={reply}
              onChange={(event) => {
                setReply(event.target.value);
                if (replyError) setReplyError(null);
              }}
              maxLength={10_000}
              rows={2}
              className="min-h-0 flex-1 resize-none"
              placeholder={t.support.replyPlaceholder}
              aria-invalid={Boolean(replyError)}
              aria-describedby={replyError ? "support-chat-reply-error" : undefined}
            />
            <Button type="submit" size="icon" disabled={actionPending} aria-label={t.support.sendFinalReply}>
              {sendReply.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {replyError && (
            <p id="support-chat-reply-error" className="mt-2 text-xs text-destructive">
              {replyError}
            </p>
          )}
        </form>
      )}

      {request.status === "closed" && (
        <div className="border-t bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          {t.support.threadClosed}
        </div>
      )}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!deleteRequestMutation.isPending) setDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.support.deleteRequestTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.support.deleteRequestDescription, { subject: request.subject })}
            </AlertDialogDescription>
            {deleteError && (
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel render={<Button variant="outline" disabled={deleteRequestMutation.isPending} />}>
              {t.common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" disabled={deleteRequestMutation.isPending} />}
              onClick={(event) => {
                event.preventDefault();
                void deleteRequest();
              }}
            >
              {deleteRequestMutation.isPending ? t.support.deletingRequest : t.support.deleteRequest}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
