"use client";

import { cn } from "@DashboardV2/ui/lib/utils";

import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

export type SupportMessageRow = {
  id: string;
  body: string;
  authorName: string;
  authorSide: "requester" | "support";
  createdAt: string | Date;
};

/**
 * One request read as a conversation.
 *
 * The opening message is passed separately rather than as the first row of
 * `messages`, because it genuinely is not one: it lives on the request itself
 * (it carries the subject, and the inbox list previews it), and only the
 * replies after it are rows in support_message.
 *
 * `mine` says which side the reader is on, so the same component serves the
 * requester at /support and the support account in the inbox without either of
 * them seeing their own words on the wrong side.
 */
export function SupportTranscript({
  opening,
  messages,
  mine,
  className,
}: {
  opening: { body: string; authorName: string; createdAt: string | Date };
  messages: SupportMessageRow[];
  mine: "requester" | "support";
  className?: string;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();

  const rows: (SupportMessageRow & { opening?: boolean })[] = [
    {
      id: "__opening__",
      body: opening.body,
      authorName: opening.authorName,
      authorSide: "requester",
      createdAt: opening.createdAt,
      opening: true,
    },
    ...messages,
  ];

  return (
    <ol className={cn("space-y-4", className)} aria-label={t.support.conversation}>
      {rows.map((row) => {
        const isMine = row.authorSide === mine;
        return (
          <li
            key={row.id}
            className={cn("flex flex-col gap-1", isMine ? "items-end" : "items-start")}
          >
            <div className="flex items-baseline gap-2 px-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {isMine ? t.support.you : row.authorName}
              </span>
              <span>{formatDateTime(row.createdAt)}</span>
            </div>
            <div
              className={cn(
                // max-w so a long paragraph still reads as a message rather
                // than filling the pane edge to edge.
                "max-w-[42rem] rounded-lg px-3 py-2 text-sm/relaxed whitespace-pre-wrap",
                isMine
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-foreground",
              )}
            >
              {row.body}
            </div>
            {row.opening && (
              <span className="px-1 text-xs text-muted-foreground">
                {t.support.openingMessage}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
