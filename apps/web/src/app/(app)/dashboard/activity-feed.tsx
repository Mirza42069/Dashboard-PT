"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { interpolate } from "@/i18n";
import type { Dictionary } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useStatusLabel } from "@/components/status-badge";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

type Sentences = Dictionary["activity"]["sentence"];

export default function ActivityFeed() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const statusLabel = useStatusLabel();
  const query = useQuery(trpc.activity.list.queryOptions({ limit: 10, offset: 0 }));

  /**
   * The row stores a stable `action` key, never a sentence, so the feed renders
   * in whichever language the reader chose and old rows follow wording changes.
   */
  function describe(entry: {
    entityType: string;
    action: string;
    actorName: string;
    entityLabel: string;
    detail: string | null;
  }) {
    const key = `${entry.entityType}_${entry.action}` as keyof Sentences;
    const template = t.activity.sentence[key] ?? t.activity.sentence.fallback;

    // `detail` holds raw keys (a role), localize them so the sentence doesn't
    // switch to English mid-way.
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
    <Card>
      <CardHeader>
        <CardTitle>{t.activity.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {query.isPending &&
          Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-5 w-full" />)}

        {!query.isPending && (query.data?.entries.length ?? 0) === 0 && (
          <p className="text-muted-foreground">{t.activity.empty}</p>
        )}

        {(query.data?.entries ?? []).map((entry) => (
          // Not a link: the entity may be gone, and a feed of 404s is worse
          // than plain text.
          <div key={entry.id} className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 flex-1">{describe(entry)}</p>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {formatDateTime(entry.createdAt)}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
