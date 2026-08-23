import { db } from "@DashboardV2/db";
import { notePhoto, project, projectNote } from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { desc, eq, inArray } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import {
  assertNoteWritable,
  assertProjectAccess,
  assertProjectWritable,
} from "../lib/scope";

export const noteRouter = router({
  listByProject: companyPermissionProcedure("project:read")
    .input(z.object({ projectId: z.string().min(1), limit: z.number().int().min(1).max(100).default(50) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const notes = await db
        .select()
        .from(projectNote)
        .where(eq(projectNote.projectId, input.projectId))
        .orderBy(desc(projectNote.createdAt))
        .limit(input.limit);

      if (notes.length === 0) return { notes: [] };

      // Everything except `data` — the bytes are megabytes each and are
      // served by GET /photos/:id, never through tRPC JSON.
      const photos = await db
        .select({
          id: notePhoto.id,
          noteId: notePhoto.noteId,
          contentType: notePhoto.contentType,
          size: notePhoto.size,
          createdAt: notePhoto.createdAt,
        })
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

  /** Recording site evidence is exactly what an assigned project member is there to do. */
  create: companyPermissionProcedure("project:write")
    .input(
      z.object({
        projectId: z.string().min(1),
        body: z.string().trim().min(1, "Write something first").max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectWritable(ctx, input.projectId);
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
        entityLabel: `${target.code} - ${target.name}`,
      });

      return { id: created.id };
    }),

  // Photo uploads bypass tRPC: the browser POSTs raw bytes to
  // /notes/:noteId/photos on the Hono server, which inserts the row itself.

  deletePhoto: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Resolve the owning note first so scope is checked before the delete.
      const [photo] = await db
        .select({ noteId: notePhoto.noteId })
        .from(notePhoto)
        .where(eq(notePhoto.id, input.id));
      if (!photo) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Photo not found" });
      }
      await assertNoteWritable(ctx, photo.noteId);

      await db.delete(notePhoto).where(eq(notePhoto.id, input.id));
      return { success: true };
    }),

  delete: companyPermissionProcedure("project:write")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertNoteWritable(ctx, input.id);
      // Bytes live in note_photo rows, so the cascade removes them too.
      await db.delete(projectNote).where(eq(projectNote.id, input.id));
      return { success: true };
    }),
});
