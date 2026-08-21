ALTER TABLE "ai_credit_refund" ADD COLUMN "status" text DEFAULT 'refunded' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_credit_refund" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "ai_credit_refund" ADD COLUMN "settled_at" timestamp;--> statement-breakpoint
CREATE INDEX "aiCreditRefund_statusCreatedAt_idx" ON "ai_credit_refund" USING btree ("status","created_at");
