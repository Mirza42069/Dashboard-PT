CREATE TABLE "boq_item" (
	"id" text PRIMARY KEY NOT NULL,
	"boq_version_id" text NOT NULL,
	"parent_id" text,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"unit" text,
	"quantity" numeric(20, 4),
	"unit_rate" numeric(20, 4),
	"value" numeric(20, 2) GENERATED ALWAYS AS (quantity * unit_rate) STORED,
	"weight" numeric(9, 6) DEFAULT '0' NOT NULL,
	"weight_source" text DEFAULT 'derived' NOT NULL,
	"distribution" text DEFAULT 'linear' NOT NULL,
	"progress_mode" text DEFAULT 'by_quantity' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_item_distribution" (
	"id" text PRIMARY KEY NOT NULL,
	"boq_item_id" text NOT NULL,
	"period_id" text NOT NULL,
	"planned_pct" numeric(9, 6) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boq_version" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_value" numeric(20, 2),
	"baselined_at" timestamp,
	"baselined_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_id" text NOT NULL,
	"boq_item_id" text NOT NULL,
	"cumulative_quantity" numeric(20, 4),
	"cumulative_percent" numeric(9, 4),
	"pct_complete" numeric(9, 4) DEFAULT '0' NOT NULL,
	"note" text,
	"recorded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_period" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_index" integer NOT NULL,
	"label" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "period_type" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "schedule_start" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "data_date" date;--> statement-breakpoint
ALTER TABLE "boq_item" ADD CONSTRAINT "boq_item_boq_version_id_boq_version_id_fk" FOREIGN KEY ("boq_version_id") REFERENCES "public"."boq_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item" ADD CONSTRAINT "boq_item_parent_id_boq_item_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."boq_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item_distribution" ADD CONSTRAINT "boq_item_distribution_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_item_distribution" ADD CONSTRAINT "boq_item_distribution_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_version" ADD CONSTRAINT "boq_version_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boq_version" ADD CONSTRAINT "boq_version_baselined_by_id_user_id_fk" FOREIGN KEY ("baselined_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entry" ADD CONSTRAINT "progress_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entry" ADD CONSTRAINT "progress_entry_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entry" ADD CONSTRAINT "progress_entry_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_entry" ADD CONSTRAINT "progress_entry_recorded_by_id_user_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "reporting_period_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "boqItem_boqVersionId_idx" ON "boq_item" USING btree ("boq_version_id");--> statement-breakpoint
CREATE INDEX "boqItem_parentId_idx" ON "boq_item" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boqItem_version_parent_code_idx" ON "boq_item" USING btree ("boq_version_id",coalesce(parent_id, ''),"code") WHERE deleted_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "boqItemDistribution_item_period_idx" ON "boq_item_distribution" USING btree ("boq_item_id","period_id");--> statement-breakpoint
CREATE INDEX "boqItemDistribution_periodId_idx" ON "boq_item_distribution" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "boqVersion_projectId_idx" ON "boq_version" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boqVersion_project_versionNo_idx" ON "boq_version" USING btree ("project_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "boqVersion_oneActive_idx" ON "boq_version" USING btree ("project_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "progressEntry_period_item_idx" ON "progress_entry" USING btree ("period_id","boq_item_id");--> statement-breakpoint
CREATE INDEX "progressEntry_projectId_idx" ON "progress_entry" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "progressEntry_boqItemId_idx" ON "progress_entry" USING btree ("boq_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reportingPeriod_project_index_idx" ON "reporting_period" USING btree ("project_id","period_index");--> statement-breakpoint
CREATE INDEX "reportingPeriod_project_endDate_idx" ON "reporting_period" USING btree ("project_id","end_date");