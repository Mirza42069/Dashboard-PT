-- Reporting-period workflow.
--
-- Purely additive. The two statuses that already exist — 'open' and 'locked' —
-- are both still legal values under the widened set, so every existing period
-- keeps the meaning it had and no data migration is needed.
--
-- Deliberately *not* backfilled: a period that was locked before this migration
-- has no locked_by_id and no locked_at, and it stays that way. Stamping the
-- migration's own timestamp on it, or attributing it to whoever happens to run
-- this, would put a name against an approval that person never gave — which is
-- the one thing an audit trail must never do.

CREATE TABLE "reporting_period_event" (
	"id" text PRIMARY KEY NOT NULL,
	"period_id" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"actor_id" text,
	"actor_name" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress_entry" ADD COLUMN "no_progress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "submitted_by_id" text;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "reviewed_by_id" text;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "approved_by_id" text;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "locked_by_id" text;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD COLUMN "review_comment" text;--> statement-breakpoint
ALTER TABLE "reporting_period_event" ADD CONSTRAINT "reporting_period_event_period_id_reporting_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."reporting_period"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_period_event" ADD CONSTRAINT "reporting_period_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reportingPeriodEvent_periodId_idx" ON "reporting_period_event" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "reportingPeriodEvent_createdAt_idx" ON "reporting_period_event" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "reporting_period_submitted_by_id_user_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "reporting_period_reviewed_by_id_user_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "reporting_period_approved_by_id_user_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "reporting_period_locked_by_id_user_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reportingPeriod_project_status_idx" ON "reporting_period" USING btree ("project_id","status");