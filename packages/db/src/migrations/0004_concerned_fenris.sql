ALTER TABLE "note_photo" ALTER COLUMN "content_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "note_photo" ADD COLUMN "data" "bytea" NOT NULL;