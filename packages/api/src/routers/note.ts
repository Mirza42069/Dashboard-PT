import { db } from "@DashboardV2/db";
import { notePhoto, project, projectNote } from "@DashboardV2/db/schema";
import { env } from "@DashboardV2/env/server";
import { TRPCError } from "@trpc/server";
import { del } from "@vercel/blob";
import { desc, eq, inArray } from "drizzle-orm";
import z from "zod";

import { adminProcedure, protectedProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";

/**
 * Removes objects from Blob storage. Never throws: a note row that is already
 * gone must not resurrect because cleanup failed, and an orphaned blob is a
 * billing footnote, not a correctness problem.
 */
async function deleteBlobs(pathnames: string[]) {
  if (pathnames.length === 0 || !env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(pathnames, { token: env.BLOB_READ_WRITE_TOKEN });
  } catch (error) {
    console.warn("[note] blob cleanup failed:", error instanceof Error ? error.message : error);
  }
}

export const noteRouter = router({
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ input }) => {
      const notes = await db
        .select()
        .from(projectNote)
        .where(eq(projectNote.projectId, input.projectId))
        .orderBy(desc(projectNote.createdAt))
        .limit(input.limit);

      if (notes.length === 0) return { notes: [] };

      const photos = await db
        .select()
        .from(notePhoto)
        .where(
          inArray(
            notePhoto.noteId,
            notes.map((row) => row.id),
          ),
        )
        .orderBy(notePhoto.createdAt);

      return {
        notes: notes.map((note) => ({
          ...note,
          photos: photos.filter((photo) => photo.noteId === note.id),
        })),
      };
    }),

  /**
   * protectedProcedure, not admin: recording site evidence is exactly what
   * non-admin site staff are there to do. Deleting a note stays admin-only.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        body: z.string().trim().min(1, "Write something first").max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = await db
        .select({ id: project.id, code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, input.projectId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [created] = await db
        .insert(projectNote)
        .values({
          projectId: input.projectId,
          body: input.body,
          authorId: ctx.session.user.id,
          authorName: ctx.session.user.name,
        })
        .returning({ id: projectNote.id });

      if (!created) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the note" });
      }

      await recordActivity(ctx, {
        action: "created",
        entityType: "note",
        entityId: created.id,
        entityLabel: `${target.code} · ${target.name}`,
      });

      return { id: created.id };
    }),

  /**
   * Called by the browser after upload() resolves. The note row already exists
   * at this point by design: if this call fails you get a note with fewer
   * photos, which is visible and fixable. Uploading first would leave a blob
   * nothing in the database references.
   */
  attachPhoto: protectedProcedure
    .input(
      z.object({
        noteId: z.string().min(1),
        url: z.url(),
        pathname: z.string().min(1),
        contentType: z.string().max(100).optional(),
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [note] = await db
        .select({ id: projectNote.id })
        .from(projectNote)
        .where(eq(projectNote.id, input.noteId));
      if (!note) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
      }

      const [created] = await db.insert(notePhoto).values(input).returning({ id: notePhoto.id });
      return { id: created?.id };
    }),

  deletePhoto: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [photo] = await db.select().from(notePhoto).where(eq(notePhoto.id, input.id));
      if (!photo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found" });
      }

      await db.delete(notePhoto).where(eq(notePhoto.id, input.id));
      await deleteBlobs([photo.pathname]);

      return { success: true };
    }),

  delete: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ input }) => {
    // Read the pathnames before the cascade removes them.
    const photos = await db
      .select({ pathname: notePhoto.pathname })
      .from(notePhoto)
      .where(eq(notePhoto.noteId, input.id));

    await db.delete(projectNote).where(eq(projectNote.id, input.id));
    await deleteBlobs(photos.map((photo) => photo.pathname));

    return { success: true, deletedPhotos: photos.length };
  }),
});
