ALTER TABLE "project" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
CREATE INDEX "project_company_archived_idx" ON "project" USING btree ("company_id","archived_at");