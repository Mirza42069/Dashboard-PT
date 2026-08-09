"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import { Card } from "@DashboardV2/ui/components/card";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@DashboardV2/ui/components/sheet";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Inbox, Loader2, SearchX, Send } from "@DashboardV2/ui/components/icons";
import { useEffect, useRef, useState } from "react";

import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 30_000;
const STATUSES = ["new", "accepted", "answered", "closed"] as const;
type SupportStatus = (typeof STATUSES)[number];
type SupportRequest = inferOutput<typeof trpc.support.list>["requests"][number];

function statusClass(status: SupportStatus) {
  if (status === "new") return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (status === "accepted") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (status === "answered") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  return "border-border bg-muted text-muted-foreground";
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

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={200}
          placeholder={t.support.searchPlaceholder}
          aria-label={t.support.searchLabel}
          className="sm:max-w-sm"
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
            <SelectTrigger
              id="support-status"
              className="w-full sm:w-40"
              aria-label={t.support.filterStatus}
            >
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

      {inbox.isPending && (
        <div className="space-y-2" role="status" aria-label={t.support.loadingInbox}>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      )}

      {initialError && (
        <QueryError error={inbox.error} onRetry={() => void inbox.refetch()} />
      )}

      {!inbox.isPending &&
        !initialError &&
        requests.length === 0 && (
          <Card className="flex min-h-64 flex-col items-center justify-center gap-3 border-dashed p-8 text-center">
            {hasSearch || status !== "all" ? (
              <SearchX className="size-6 text-muted-foreground" />
            ) : (
              <Inbox className="size-6 text-muted-foreground" />
            )}
            <div className="space-y-1">
              <p className="font-medium">
                {hasSearch || status !== "all"
                  ? t.support.noMatches
                  : t.support.emptyInbox}
              </p>
              <p className="text-sm text-muted-foreground">
                {hasSearch || status !== "all"
                  ? t.support.noMatchesDescription
                  : t.support.emptyInboxDescription}
              </p>
            </div>
            {(hasSearch || status !== "all") && (
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
            )}
          </Card>
        )}

      {!initialError && requests.length > 0 && (
        <div className="space-y-2" aria-label={t.support.requestList}>
          {requests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              formatDateTime={formatDateTime}
              onOpen={() => setSelectedId(request.id)}
            />
          ))}
        </div>
      )}

      {inbox.isFetchNextPageError && (
        <QueryError
          error={inbox.error}
          onRetry={() => void inbox.fetchNextPage()}
          className="px-4 py-6"
        />
      )}

      {!initialError &&
        !inbox.isFetchNextPageError &&
        inbox.hasNextPage && (
          <div
            ref={loadMoreRef}
            className="flex min-h-12 items-center justify-center"
            aria-live="polite"
          >
            {inbox.isFetchingNextPage && (
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                {t.support.loadingMore}
              </span>
            )}
          </div>
        )}

      {!inbox.isPending && !initialError && !inbox.hasNextPage && requests.length > 0 && (
        <p role="status" className="py-3 text-center text-sm text-muted-foreground">
          {hasSearch
            ? interpolate(t.support.searchComplete, { count: requests.length })
            : t.support.endOfInbox}
        </p>
      )}

      <RequestSheet
        selectedId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </>
  );
}

function RequestRow({
  request,
  formatDateTime,
  onOpen,
}: {
  request: SupportRequest;
  formatDateTime: (value: string | Date | null | undefined) => string;
  onOpen: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full gap-3 rounded-lg border bg-card p-4 text-left transition-[background-color,border-color] hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{request.subject}</p>
          <Badge variant="outline" className={statusClass(request.status)}>
            {t.support.status[request.status]}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {request.requesterName} · {request.companyName}
        </p>
        <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{request.message}</p>
      </div>
      <time
        className="whitespace-nowrap text-xs text-muted-foreground"
        dateTime={new Date(request.createdAt).toISOString()}
      >
        {formatDateTime(request.createdAt)}
      </time>
    </button>
  );
}

function RequestSheet({
  selectedId,
  onOpenChange,
}: {
  selectedId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const statusFocusRef = useRef<HTMLDivElement>(null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detail = useQuery({
    ...trpc.support.get.queryOptions({ id: selectedId ?? "" }),
    enabled: Boolean(selectedId),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
  const accept = useMutation(trpc.support.accept.mutationOptions());
  const sendReply = useMutation(trpc.support.reply.mutationOptions());
  const close = useMutation(trpc.support.close.mutationOptions());
  const request = detail.data;
  const actionPending = accept.isPending || sendReply.isPending || close.isPending;

  useEffect(() => {
    if (request?.status === "accepted") replyRef.current?.focus();
    else if (request?.status === "answered") closeButtonRef.current?.focus();
    else if (request?.status === "closed") statusFocusRef.current?.focus();
  }, [request?.status]);

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
      () => sendReply.mutateAsync({ id: selectedId ?? "", reply: cleanReply }),
      t.support.replySent,
    );
    if (succeeded) setReply("");
  }

  return (
    <Sheet
      open={Boolean(selectedId)}
      onOpenChange={(open) => {
        if (!open && !actionPending) {
          setReply("");
          setReplyError(null);
          setActionError(null);
          onOpenChange(false);
        }
      }}
    >
      <SheetContent
        side="right"
        closeLabel={t.common.close}
        showCloseButton={!actionPending}
        className="w-full sm:max-w-xl"
      >
        {detail.isPending && (
          <div
            className="space-y-4 p-4"
            role="status"
            aria-label={t.support.loadingRequest}
          >
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {detail.isError && (
          <div className="p-4">
            <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
          </div>
        )}

        {request && (
          <>
            <SheetHeader className="border-b pr-12">
              <div
                ref={statusFocusRef}
                tabIndex={-1}
                aria-live="polite"
                className="mb-1 flex flex-wrap items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Badge variant="outline" className={statusClass(request.status)}>
                  {t.support.status[request.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(request.createdAt)}
                </span>
              </div>
              <SheetTitle className="text-base">{request.subject}</SheetTitle>
              <SheetDescription>
                {request.requesterName} &lt;{request.requesterEmail}&gt;
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 border-b px-4 py-3 text-xs">
                <dt className="text-muted-foreground">{t.support.company}</dt>
                <dd className="min-w-0 truncate text-foreground">
                  {request.companyName} ({request.companyCode})
                </dd>
                <dt className="text-muted-foreground">{t.support.received}</dt>
                <dd className="text-foreground">{formatDateTime(request.createdAt)}</dd>
              </dl>

              <div className="px-4 py-6">
                <p className="whitespace-pre-wrap text-sm/relaxed text-foreground">
                  {request.message}
                </p>
              </div>

              {request.acceptedAt && (
                <div className="mx-4 mb-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {interpolate(t.support.acceptedBy, {
                    actor: request.acceptedByName ?? t.support.supportTeam,
                    date: formatDateTime(request.acceptedAt),
                  })}
                </div>
              )}

              {request.finalReply && (
                <div className="mx-4 mb-4 rounded-lg border bg-card p-4">
                  <p className="mb-2 font-medium text-foreground">{t.support.finalReply}</p>
                  <p className="whitespace-pre-wrap text-sm/relaxed text-foreground">
                    {request.finalReply}
                  </p>
                  {request.repliedAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      {interpolate(t.support.repliedBy, {
                        actor: request.repliedByName ?? t.support.supportTeam,
                        date: formatDateTime(request.repliedAt),
                      })}
                    </p>
                  )}
                </div>
              )}

              {request.closedAt && (
                <div className="mx-4 mb-4 text-xs text-muted-foreground">
                  {interpolate(t.support.closedBy, {
                    actor: request.closedByName ?? t.support.supportTeam,
                    date: formatDateTime(request.closedAt),
                  })}
                </div>
              )}

              {request.status === "accepted" && (
                <form
                  className="space-y-3 border-t px-4 py-4"
                  onSubmit={handleReply}
                  aria-busy={sendReply.isPending}
                  noValidate
                >
                  <div className="space-y-2">
                    <Label htmlFor="support-final-reply">{t.support.finalReply}</Label>
                    <Textarea
                      ref={replyRef}
                      id="support-final-reply"
                      value={reply}
                      onChange={(event) => {
                        setReply(event.target.value);
                        if (replyError) setReplyError(null);
                      }}
                      maxLength={10_000}
                      className="min-h-32"
                      placeholder={t.support.replyPlaceholder}
                      aria-invalid={Boolean(replyError)}
                      aria-describedby={replyError ? "support-final-reply-error" : undefined}
                    />
                    {replyError && (
                      <p id="support-final-reply-error" className="text-xs text-destructive">
                        {replyError}
                      </p>
                    )}
                  </div>
                  <Button type="submit" disabled={actionPending}>
                    <Send />
                    {sendReply.isPending ? t.support.replying : t.support.sendFinalReply}
                  </Button>
                </form>
              )}

              {actionError && (
                <p role="alert" className="mx-4 mb-4 text-xs text-destructive">
                  {actionError}
                </p>
              )}
            </div>

            {(request.status === "new" || request.status === "answered") && (
              <SheetFooter className="border-t bg-card">
                {request.status === "new" && (
                  <Button
                    onClick={() =>
                      void run(
                        () => accept.mutateAsync({ id: request.id }),
                        t.support.requestAccepted,
                      )
                    }
                    disabled={actionPending}
                  >
                    <CheckCircle2 />
                    {accept.isPending ? t.support.accepting : t.support.acceptRequest}
                  </Button>
                )}
                {request.status === "answered" && (
                  <Button
                    ref={closeButtonRef}
                    variant="outline"
                    onClick={() =>
                      void run(
                        () => close.mutateAsync({ id: request.id }),
                        t.support.requestClosed,
                      )
                    }
                    disabled={actionPending}
                  >
                    {close.isPending ? t.support.closing : t.support.closeRequest}
                  </Button>
                )}
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
