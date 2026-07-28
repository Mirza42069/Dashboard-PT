-- Blob-era rows hold only a URL into the deleted Vercel Blob store; nothing to keep.
DELETE FROM "note_photo";--> statement-breakpoint
ALTER TABLE "note_photo" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "note_photo" DROP COLUMN "pathname";