ALTER TABLE "boq_item" DROP COLUMN "value";--> statement-breakpoint
ALTER TABLE "boq_item" ALTER COLUMN "quantity" SET DATA TYPE numeric(24, 8);--> statement-breakpoint
ALTER TABLE "boq_item" ALTER COLUMN "unit_rate" SET DATA TYPE numeric(24, 8);--> statement-breakpoint
ALTER TABLE "boq_item" ADD COLUMN "value" numeric(26, 8) GENERATED ALWAYS AS ("quantity" * "unit_rate") STORED;--> statement-breakpoint
ALTER TABLE "progress_entry" ALTER COLUMN "cumulative_quantity" SET DATA TYPE numeric(24, 8);
