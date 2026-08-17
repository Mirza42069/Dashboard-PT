CREATE UNIQUE INDEX "boqImport_project_id_idx" ON "boq_import" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reportingPeriod_project_id_idx" ON "reporting_period" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "project_actual_curve" ADD CONSTRAINT "project_actual_curve_project_period_fk" FOREIGN KEY ("project_id","period_id") REFERENCES "public"."reporting_period"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_actual_curve" ADD CONSTRAINT "project_actual_curve_project_import_fk" FOREIGN KEY ("project_id","boq_import_id") REFERENCES "public"."boq_import"("project_id","id") ON DELETE no action ON UPDATE no action;
