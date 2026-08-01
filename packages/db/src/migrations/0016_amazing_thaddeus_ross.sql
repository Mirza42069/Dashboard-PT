CREATE TABLE "boq_import" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"boq_version_id" text,
	"filename" text NOT NULL,
	"sheet_name" text NOT NULL,
	"imported_by_id" text,
	"imported_by_name" text NOT NULL,
	"status" text NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_imported" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"mapping" text,
	"errors" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boq_item" ADD COLUMN "planned_start_period_index" integer;--> statement-breakpoint
ALTER TABLE "boq_item" ADD COLUMN "planned_finish_period_index" integer;--> statement-breakpoint
ALTER TABLE "boq_import" ADD CONSTRAINT "boq_import_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_import" ADD CONSTRAINT "boq_import_boq_version_id_boq_version_id_fk" FOREIGN KEY ("boq_version_id") REFERENCES "public"."boq_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_import" ADD CONSTRAINT "boq_import_imported_by_id_user_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boqImport_projectId_idx" ON "boq_import" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "boqImport_createdAt_idx" ON "boq_import" USING btree ("created_at");--> statement-breakpoint
-- Backfill the planning window from the distribution that already exists, for
-- every revision including baselined ones.
--
-- These two columns record intent, not contract value: nothing measured — not
-- a weight, not a planned percentage, not a deviation — reads them, so writing
-- them onto a locked baseline changes no number anyone has already reported.
-- Leaving them null there instead would mean every historical revision opened
-- for revision showed an empty start and finish beside a full distribution row,
-- which reads as data loss.
--
-- Derived as the first and last period actually carrying plan. That is exactly
-- the inference the application refuses to make at runtime, and for a good
-- reason (a hand-zeroed middle period is invisible to it) — but as a one-off
-- seed for rows that have no stored window at all it is strictly better than
-- null, and any user edit overwrites it.
UPDATE "boq_item" AS item
SET "planned_start_period_index" = plan_window.first_index,
    "planned_finish_period_index" = plan_window.last_index
FROM (
  SELECT cell."boq_item_id" AS item_id,
         min(period."period_index") AS first_index,
         max(period."period_index") AS last_index
  FROM "boq_item_distribution" cell
  JOIN "reporting_period" period ON period."id" = cell."period_id"
  WHERE cell."planned_pct" > 0
  GROUP BY cell."boq_item_id"
) AS plan_window
WHERE item."id" = plan_window.item_id;