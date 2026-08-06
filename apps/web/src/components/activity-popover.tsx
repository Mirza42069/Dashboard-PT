"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Inbox } from "@DashboardV2/ui/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@DashboardV2/ui/components/popover";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { useStatusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import type { Dictionary } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

type Sentences = Dictionary["activity"]["sentence"];

export default function ActivityPopover() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const statusLabel = useStatusLabel();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    ...trpc.activity.list.queryOptions({ limit: 10, offset: 0 }),
    enabled: open,
  });

  function describe(entry: {
    entityType: string;
    action: string;
    actorName: string;
    entityLabel: string;
    detail: string | null;
  }) {
    const key = `${entry.entityType}_${entry.action}` as keyof Sentences;
    const template = t.activity.sentence[key] ?? t.activity.sentence.fallback;
    let detail = entry.detail ?? "";

    if (entry.entityType === "ticket" && entry.action === "status_changed" && detail) {
      detail = statusLabel("ticket", detail);
    } else if (entry.entityType === "user" && entry.action === "role_changed") {
      detail = detail === "admin" ? t.users.roleAdmin : t.users.roleUser;
    }

    return interpolate(template, {
      actor: entry.actorName,
      label: entry.entityLabel,
      detail,
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        openOnHover
        delay={100}
        closeDelay={150}
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.activity.title}
          >
            <Inbox />
          </Button>
        }
      />
      <PopoverContent
        side="bottom"
        align="center"
        sideOffset={8}
        aria-label={t.activity.title}
        className="w-[min(24rem,calc(100vw-1.5rem))] max-w-none p-0"
      >
        <div className="border-b px-4 py-3">
          <p className="font-semibold text-foreground">{t.activity.title}</p>
        </div>
        <div className="max-h-[min(28rem,calc(100svh-5rem))] overflow-y-auto p-2">
          {query.isPending && (
            <div className="space-y-3 p-2" aria-label={t.activity.loading}>
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          )}

          {query.isError && (
            <QueryError
              error={query.error}
              onRetry={() => void query.refetch()}
              className="border-0 px-4 py-8"
            />
          )}

          {!query.isPending && !query.isError && (query.data?.entries.length ?? 0) === 0 && (
            <p className="px-3 py-8 text-center text-muted-foreground">{t.activity.empty}</p>
          )}

          {!query.isError &&
            (query.data?.entries ?? []).map((entry) => (
              <div key={entry.id} className="px-3 py-2.5">
                <p className="text-foreground">{describe(entry)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </p>
              </div>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
