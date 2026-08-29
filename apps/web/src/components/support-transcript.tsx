"use client";

import { cn } from "@DashboardV2/ui/lib/utils";
import { env } from "@DashboardV2/env/web";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { getServerUrl } from "@/lib/server-url";
import { useFormat } from "@/lib/use-format";

export type SupportMessageRow = {
  id: string;
  body: string;
  authorName: string;
  authorSide: "requester" | "support";
  createdAt: string | Date;
};

export type SupportAttachmentRow = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
};

const screenshotSrc = (id: string) =>
  `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/support/screenshots/${id}`;

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
  events = [],
  mine,
  className,
}: {
  opening: {
    body: string;
    authorName: string;
    createdAt: string | Date;
    attachments?: SupportAttachmentRow[];
  };
  messages: SupportMessageRow[];
  events?: { id: string; label: string; createdAt: string | Date }[];
  mine: "requester" | "support";
  className?: string;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();

  const rows: (
    | (SupportMessageRow & { opening?: boolean; attachments?: SupportAttachmentRow[] })
    | { id: string; label: string; createdAt: string | Date; event: true }
  )[] = [
    {
      id: "__opening__",
      body: opening.body,
      authorName: opening.authorName,
      authorSide: "requester",
      createdAt: opening.createdAt,
      opening: true,
      attachments: opening.attachments,
    },
    ...messages,
    ...events.map((event) => ({ ...event, event: true as const })),
  ];
  rows.sort((left, right) => {
    const difference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (difference !== 0) return difference;
    if ("opening" in left && left.opening) return -1;
    if ("opening" in right && right.opening) return 1;
    return 0;
  });

  return (
    <ol className={cn("space-y-4", className)} aria-label={t.support.conversation}>
      {rows.map((row) => {
        if ("event" in row) {
          return (
            <li key={row.id} className="mx-auto w-fit rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
              {row.label}
            </li>
          );
        }
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
                "max-w-[42rem] rounded-lg px-3 py-2 text-sm/relaxed",
                isMine
                  ? "bg-primary text-primary-foreground"
                  : "border bg-card text-foreground",
              )}
            >
              <p className="whitespace-pre-wrap">{row.body}</p>
              {row.attachments && row.attachments.length > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {row.attachments.map((attachment) => (
                    <a
                      key={attachment.id}
                      href={screenshotSrc(attachment.id)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={interpolate(t.support.viewScreenshot, {
                        name: attachment.filename,
                      })}
                      className="group overflow-hidden rounded-md bg-background/90 text-foreground ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="block aspect-video overflow-hidden bg-muted">
                        {/* Authenticated routes cannot be fetched by the image optimizer. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={screenshotSrc(attachment.id)}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                        />
                      </span>
                      <span className="block truncate px-2 py-1 text-xs">{attachment.filename}</span>
                    </a>
                  ))}
                </div>
              )}
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
