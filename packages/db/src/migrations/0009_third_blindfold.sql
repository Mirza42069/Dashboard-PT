ALTER TABLE "boq_item" ADD COLUMN "lineage_id" text;--> statement-breakpoint
UPDATE "boq_item" SET "lineage_id" = "id";--> statement-breakpoint
ALTER TABLE "boq_item" ALTER COLUMN "lineage_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "boq_version" ADD COLUMN "source_version_id" text;--> statement-breakpoint
ALTER TABLE "boq_version" ADD COLUMN "schedule_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "boq_version" ADD COLUMN "schedule_baselined_at" timestamp;--> statement-breakpoint
ALTER TABLE "boq_version" ADD COLUMN "schedule_baselined_by_id" text;--> statement-breakpoint
ALTER TABLE "boq_version" ADD CONSTRAINT "boq_version_source_version_id_boq_version_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."boq_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_version" ADD CONSTRAINT "boq_version_schedule_baselined_by_id_user_id_fk" FOREIGN KEY ("schedule_baselined_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boqItem_lineageId_idx" ON "boq_item" USING btree ("lineage_id");--> statement-breakpoint
WITH ranked_drafts AS (
	SELECT "id", row_number() OVER (PARTITION BY "project_id" ORDER BY "version_no" DESC) AS position
	FROM "boq_version"
	WHERE "status" = 'draft'
)
UPDATE "boq_version"
SET "status" = 'superseded', "updated_at" = now()
FROM ranked_drafts
WHERE "boq_version"."id" = ranked_drafts."id" AND ranked_drafts.position > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "boqVersion_oneDraft_idx" ON "boq_version" USING btree ("project_id") WHERE status = 'draft';
