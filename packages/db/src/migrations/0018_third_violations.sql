CREATE TABLE "daily_report" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"report_date" date NOT NULL,
	"period_id" text,
	"weather" text,
	"weather_note" text,
	"rainfall_hours" numeric(5, 2),
	"work_performed" text,
	"delays" text,
	"safety_observations" text,
	"quality_observations" text,
	"visitors" text,
	"notes" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"prepared_by_id" text,
	"prepared_by_name" text NOT NULL,
	"submitted_at" timestamp,
	"reviewed_by_id" text,
	"reviewed_at" timestamp,
	"approved_by_id" text,
	"approved_at" timestamp,
	"return_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_action" (
	"report_id" text NOT NULL,
	"ticket_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "daily_report_action_pk" PRIMARY KEY("report_id","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "daily_report_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"material" text NOT NULL,
	"quantity" numeric(20, 4),
	"unit" text,
	"supplier" text,
	"reference" text,
	"boq_item_id" text,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_equipment" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"hours_used" numeric(8, 2),
	"idle" boolean DEFAULT false NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_event" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_manpower" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"trade" text NOT NULL,
	"headcount" integer DEFAULT 0 NOT NULL,
	"hours" numeric(8, 2),
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_report_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"report_id" text NOT NULL,
	"data" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"size" integer,
	"caption" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text,
	"kind" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_label" text NOT NULL,
	"detail" text,
	"actor_name" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"data" "bytea" NOT NULL,
	"content_type" text NOT NULL,
	"filename" text NOT NULL,
	"size" integer,
	"uploaded_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_event" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"field" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_watcher" (
	"ticket_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_watcher_pk" PRIMARY KEY("ticket_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "type" text DEFAULT 'issue' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "assignee_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "boq_item_id" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN "period_id" text;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_prepared_by_id_user_id_fk" FOREIGN KEY ("prepared_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report" ADD CONSTRAINT "daily_report_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_action" ADD CONSTRAINT "daily_report_action_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_action" ADD CONSTRAINT "daily_report_action_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_delivery" ADD CONSTRAINT "daily_report_delivery_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_delivery" ADD CONSTRAINT "daily_report_delivery_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_equipment" ADD CONSTRAINT "daily_report_equipment_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_event" ADD CONSTRAINT "daily_report_event_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_event" ADD CONSTRAINT "daily_report_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_manpower" ADD CONSTRAINT "daily_report_manpower_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_report_photo" ADD CONSTRAINT "daily_report_photo_report_id_daily_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."daily_report"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_attachment" ADD CONSTRAINT "ticket_attachment_uploaded_by_id_user_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watcher" ADD CONSTRAINT "ticket_watcher_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."ticket"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_watcher" ADD CONSTRAINT "ticket_watcher_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dailyReport_project_date_idx" ON "daily_report" USING btree ("project_id","report_date");--> statement-breakpoint
CREATE INDEX "dailyReport_projectId_status_idx" ON "daily_report" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "dailyReport_periodId_idx" ON "daily_report" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "dailyReportAction_ticketId_idx" ON "daily_report_action" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "dailyReportDelivery_reportId_idx" ON "daily_report_delivery" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dailyReportEquipment_reportId_idx" ON "daily_report_equipment" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dailyReportEvent_reportId_idx" ON "daily_report_event" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dailyReportManpower_reportId_idx" ON "daily_report_manpower" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "dailyReportPhoto_reportId_idx" ON "daily_report_photo" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "notification_user_read_idx" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "notification_createdAt_idx" ON "notification" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ticketAttachment_ticketId_idx" ON "ticket_attachment" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticketComment_ticketId_idx" ON "ticket_comment" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticketEvent_ticketId_idx" ON "ticket_event" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticketWatcher_userId_idx" ON "ticket_watcher" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assignee_id_user_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_boq_item_id_boq_item_id_fk" FOREIGN KEY ("boq_item_id") REFERENCES "public"."boq_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_assigneeId_idx" ON "ticket" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "ticket_project_due_idx" ON "ticket" USING btree ("project_id","due_date");--> statement-breakpoint
CREATE INDEX "ticket_project_type_idx" ON "ticket" USING btree ("project_id","type");