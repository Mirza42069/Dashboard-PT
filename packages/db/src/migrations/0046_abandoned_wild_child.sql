ALTER TABLE "reporting_period" DROP CONSTRAINT "reporting_period_locked_by_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "reporting_period" DROP COLUMN "locked_by_id";--> statement-breakpoint
ALTER TABLE "reporting_period" DROP COLUMN "locked_at";