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
import { upload } from "@vercel/blob/client";
import { ImagePlus, Send, Trash2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { getServerUrl } from "@/lib/server-url";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * In development this resolves to http://localhost:3000/blob/upload; in
 * production NEXT_PUBLIC_SERVER_URL is "/api", giving /api/blob/upload, which
 * vercel.json rewrites to the same Hono route.
 */
const uploadUrl = () => `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/blob/upload`;

type Pending = { file: File; previewUrl: string };

export default function NotesTab({
  projectId,
  isAdmin,
}: {
  projectId: string;
  isAdmin: boolean;
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
  const attachPhoto = useMutation(trpc.note.attachPhoto.mutationOptions());
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
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
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
   * Note row first, then uploads, then attach. If an upload fails you get a
   * note with fewer photos — visible and fixable. Uploading first would leave
   * blobs in storage that nothing in the database references.
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
          const blob = await upload(item.file.name, item.file, {
            access: "public",
            handleUploadUrl: uploadUrl(),
          });
          await attachPhoto.mutateAsync({
            noteId,
            url: blob.url,
            pathname: blob.pathname,
            contentType: item.file.type,
            size: item.file.size,
          });
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
              {isAdmin && (
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
                      onClick={() => setLightbox(photo.url)}
                    >
                      <Image
                        src={photo.url}
                        alt=""
                        fill
                        sizes="(max-width: 768px) 33vw, 160px"
                        className="object-cover"
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
              <Image src={lightbox} alt="" fill sizes="90vw" className="object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
