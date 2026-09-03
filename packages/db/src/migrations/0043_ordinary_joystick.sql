CREATE TABLE "daily_progress_item" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"boq_item_id" text,
	"source_row" integer NOT NULL,
	"code" text,
	"description" text NOT NULL,
	"unit" text,
	"quantity" numeric(24, 8),
	"unit_rate" numeric(24, 8),
	"amount" numeric(26, 8),
	"weight" numeric(9, 6) NOT NULL,
	"previous_percent" numeric(9, 6),
	"current_percent" numeric(9, 6),
	"cumulative_percent" numeric(9, 6) NOT NULL,
	"remaining_percent" numeric(9, 6),
	"previous_weighted" numeric(12, 8),
	"current_weighted" numeric(12, 8),
	"cumulative_weighted" numeric(12, 8) NOT NULL,
	"remaining_weighted" numeric(12, 8),
	"remark" text,
	"source_values" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_progress_item_source_row_check" CHECK ("daily_progress_item"."source_row" > 0),
	CONSTRAINT "daily_progress_item_weight_check" CHECK ("daily_progress_item"."weight" between 0 and 100),
	CONSTRAINT "daily_progress_item_percent_check" CHECK (("daily_progress_item"."previous_percent" is null or "daily_progress_item"."previous_percent" between 0 and 100)
        and ("daily_progress_item"."current_percent" is null or "daily_progress_item"."current_percent" between 0 and 100)
        and "daily_progress_item"."cumulative_percent" between 0 and 100
        and ("daily_progress_item"."remaining_percent" is null or "daily_progress_item"."remaining_percent" between 0 and 100))
);
--> statement-breakpoint
CREATE TABLE "daily_progress_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_id" text NOT NULL,
	"boq_version_id" text NOT NULL,
	"boq_import_id" text,
	"report_date" date NOT NULL,
	"cumulative_percent" numeric(9, 6) NOT NULL,
	"source_filename" text NOT NULL,
	"source_sheet_name" text NOT NULL,
	"source_header_row" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "dailyProgressSnapshot_project_id_idx" UNIQUE("project_id","id"),
	CONSTRAINT "daily_progress_snapshot_percent_check" CHECK ("daily_progress_snapshot"."cumulative_percent" between 0 and 100),
	CONSTRAINT "daily_progress_snapshot_header_row_check" CHECK ("daily_progress_snapshot"."source_header_row" > 0)
);
--> statement-breakpoint
ALTER TABLE "daily_progress_item" ADD CONSTRAINT "daily_progress_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_item" ADD CONSTRAINT "daily_progress_item_snapshot_id_daily_progress_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."daily_progress_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_item" ADD CONSTRAINT "daily_progress_item_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_item" ADD CONSTRAINT "daily_progress_item_project_snapshot_fk" FOREIGN KEY ("project_id","snapshot_id") REFERENCES "public"."daily_progress_snapshot"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_snapshot" ADD CONSTRAINT "daily_progress_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_snapshot" ADD CONSTRAINT "daily_progress_snapshot_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_snapshot" ADD CONSTRAINT "daily_progress_snapshot_boq_version_id_boq_version_id_fk" FOREIGN KEY ("boq_version_id") REFERENCES "public"."boq_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_snapshot" ADD CONSTRAINT "daily_progress_snapshot_boq_import_id_boq_import_id_fk" FOREIGN KEY ("boq_import_id") REFERENCES "public"."boq_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_progress_snapshot" ADD CONSTRAINT "daily_progress_snapshot_project_period_fk" FOREIGN KEY ("project_id","period_id") REFERENCES "public"."reporting_period"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dailyProgressItem_snapshot_row_idx" ON "daily_progress_item" USING btree ("snapshot_id","source_row");--> statement-breakpoint
CREATE INDEX "dailyProgressItem_projectId_idx" ON "daily_progress_item" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "dailyProgressItem_boqItemId_idx" ON "daily_progress_item" USING btree ("boq_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dailyProgressSnapshot_project_date_idx" ON "daily_progress_snapshot" USING btree ("project_id","report_date");--> statement-breakpoint
CREATE INDEX "dailyProgressSnapshot_periodId_idx" ON "daily_progress_snapshot" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "dailyProgressSnapshot_boqVersionId_idx" ON "daily_progress_snapshot" USING btree ("boq_version_id");--> statement-breakpoint
CREATE INDEX "dailyProgressSnapshot_boqImportId_idx" ON "daily_progress_snapshot" USING btree ("boq_import_id");