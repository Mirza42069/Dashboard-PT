CREATE TABLE "project_actual_curve" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_id" text NOT NULL,
	"boq_import_id" text,
	"cumulative_percent" numeric(9, 6) NOT NULL,
	"source_filename" text NOT NULL,
	"source_sheet_name" text NOT NULL,
	"source_row" integer NOT NULL,
	"source_column" integer NOT NULL,
	"source_value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_actual_curve_cumulative_percent_check" CHECK ("project_actual_curve"."cumulative_percent" between 0 and 100),
	CONSTRAINT "project_actual_curve_source_position_check" CHECK ("project_actual_curve"."source_row" > 0 and "project_actual_curve"."source_column" > 0)
);
--> statement-breakpoint
ALTER TABLE "project_actual_curve" ADD CONSTRAINT "project_actual_curve_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actual_curve" ADD CONSTRAINT "project_actual_curve_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actual_curve" ADD CONSTRAINT "project_actual_curve_boq_import_id_boq_import_id_fk" FOREIGN KEY ("boq_import_id") REFERENCES "public"."boq_import"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projectActualCurve_project_period_idx" ON "project_actual_curve" USING btree ("project_id","period_id");--> statement-breakpoint
CREATE INDEX "projectActualCurve_periodId_idx" ON "project_actual_curve" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "projectActualCurve_boqImportId_idx" ON "project_actual_curve" USING btree ("boq_import_id");