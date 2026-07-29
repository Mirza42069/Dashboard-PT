"use client";

import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@DashboardV2/ui/components/attachment";
import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
import { Dialog, DialogContent, DialogTitle } from "@DashboardV2/ui/components/dialog";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { env } from "@DashboardV2/env/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Send, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { compressImage } from "@/lib/compress-image";
import { getServerUrl } from "@/lib/server-url";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * In development these resolve against http://localhost:3000; in production
 * NEXT_PUBLIC_SERVER_URL is "/api", which vercel.json rewrites to the same
 * Hono routes.
 */
const uploadUrl = (noteId: string) =>
  `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/notes/${noteId}/photos`;
const photoSrc = (photoId: string) =>
  `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/photos/${photoId}`;

/** Intake limit — files are compressed to ~1 MB in-browser before upload. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

type Pending = { file: File; previewUrl: string };

export default function NotesTab({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const { formatDateTime } = useFormat();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [body, setBody] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);

  const notesQuery = useQuery(trpc.note.listByProject.queryOptions({ projectId }));
  const createNote = useMutation(trpc.note.create.mutationOptions());
  const deleteNote = useMutation(trpc.note.delete.mutationOptions());
  const deletePhoto = useMutation(trpc.note.deletePhoto.mutationOptions());

  // Object URLs are leaked memory until revoked; clear whatever is still held.
  useEffect(() => {
    return () => {
      for (const item of pending) URL.revokeObjectURL(item.previewUrl);
    };
  }, [pending]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const images = Array.from(files).filter((file) => {
      if (!file.type.startsWith("image/")) return false;
      if (file.size > MAX_FILE_BYTES) {
        toast.error(interpolate(t.notes.tooLarge, { name: file.name }));
        return false;
      }
      return true;
    });
    setPending((current) => [
      ...current,
      ...images.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removePending(index: number) {
    setPending((current) => {
      const item = current[index];
      if (item) URL.revokeObjectURL(item.previewUrl);
      return current.filter((_, i) => i !== index);
    });
  }

  /**
   * Note row first, then photos — each upload needs a note id to hang off.
   * A failed upload therefore costs you one photo, not the whole note, and
   * the toast names the file so it can be re-added.
   */
  async function submit() {
    if (body.trim() === "") {
      toast.error(t.notes.bodyRequired);
      return;
    }

    setBusy(true);
    try {
      const { id: noteId } = await createNote.mutateAsync({ projectId, body: body.trim() });
      if (!noteId) throw new Error(t.notes.createFailed);

      for (const item of pending) {
        try {
          // Compress client-side: the server (and Vercel) cap bodies at ~4 MB.
          const blob = await compressImage(item.file);
          const response = await fetch(uploadUrl(noteId), {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null;
            throw new Error(payload?.error ?? `Upload failed (${response.status})`);
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : "";
          toast.error(
            `${interpolate(t.notes.uploadFailed, { name: item.file.name })}${detail ? ` — ${detail}` : ""}`,
          );
        }
      }

      for (const item of pending) URL.revokeObjectURL(item.previewUrl);
      setPending([]);
      setBody("");
      if (fileInput.current) fileInput.current.value = "";
      await queryClient.invalidateQueries(trpc.note.pathFilter());
      await queryClient.invalidateQueries(trpc.activity.pathFilter());
      toast.success(t.notes.created);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.notes.createFailed);
    } finally {
      setBusy(false);
    }
  }

  const notes = notesQuery.data?.notes ?? [];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t.notes.placeholder}
          />

          {pending.length > 0 && (
            <AttachmentGroup>
              {pending.map((item, index) => (
                <Attachment
                  key={item.previewUrl}
                  orientation="vertical"
                  state={busy ? "uploading" : "done"}
                >
                  <AttachmentMedia variant="image">
                    {/* Local object URL — next/image would need it whitelisted. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.previewUrl} alt={item.file.name} />
                  </AttachmentMedia>
                  <AttachmentContent>
                    <AttachmentTitle>{item.file.name}</AttachmentTitle>
                  </AttachmentContent>
                  {!busy && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.notes.deletePhoto}
                      className="absolute top-1 right-1 z-20 bg-background/80"
                      onClick={() => removePending(index)}
                    >
                      <X />
                    </Button>
                  )}
                </Attachment>
              ))}
            </AttachmentGroup>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus />
              {t.notes.addPhotos}
            </Button>
            <span className="text-xs text-muted-foreground">{t.notes.hint}</span>
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void submit()}>
              <Send />
              {busy ? t.notes.posting : t.notes.post}
            </Button>
          </div>
        </CardContent>
      </Card>

      {notesQuery.isPending && <Skeleton className="h-32 w-full" />}

      {!notesQuery.isPending && notes.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t.notes.empty}
          </CardContent>
        </Card>
      )}

      {notes.map((note) => (
        <Card key={note.id}>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{note.authorName}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(note.createdAt)}</p>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.notes.deleteNote}
                  onClick={async () => {
                    try {
                      await deleteNote.mutateAsync({ id: note.id });
                      await queryClient.invalidateQueries(trpc.note.pathFilter());
                      toast.success(t.notes.deleted);
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
                    }
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>

            <p className="whitespace-pre-wrap">{note.body}</p>

            {note.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {note.photos.map((photo) => (
                  <div key={photo.id} className="group relative aspect-square">
                    <button
                      type="button"
                      aria-label={t.notes.viewPhoto}
                      className="relative block size-full overflow-hidden rounded-md ring-1 ring-foreground/10"
                      onClick={() => setLightbox(photo.id)}
                    >
                      {/* Plain <img>: the next/image optimizer fetches without
                          the session cookie the /photos route requires. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoSrc(photo.id)}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 size-full object-cover"
                      />
                    </button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t.notes.deletePhoto}
                      className="absolute top-1 right-1 hidden bg-background/80 group-hover:inline-flex"
                      onClick={async () => {
                        try {
                          await deletePhoto.mutateAsync({ id: photo.id });
                          await queryClient.invalidateQueries(trpc.note.pathFilter());
                          toast.success(t.notes.photoDeleted);
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : t.common.somethingWentWrong,
                          );
                        }
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => {
          if (!open) setLightbox(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle className="sr-only">{t.notes.viewPhoto}</DialogTitle>
          {lightbox && (
            <div className="relative aspect-video w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoSrc(lightbox)}
                alt=""
                className="absolute inset-0 size-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
