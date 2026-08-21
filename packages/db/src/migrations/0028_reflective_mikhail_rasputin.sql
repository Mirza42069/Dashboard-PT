CREATE TABLE "ai_credit_refund" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_credit_refund" ADD CONSTRAINT "ai_credit_refund_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aiCreditRefund_createdAt_idx" ON "ai_credit_refund" USING btree ("created_at");