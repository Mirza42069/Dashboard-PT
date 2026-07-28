DROP TABLE IF EXISTS "task";
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"issuer_id" text,
	"issuer_name" text NOT NULL,
	"responsible_name" text NOT NULL,
	"responsible_contact_number" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_issuer_id_user_id_fk" FOREIGN KEY ("issuer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ticket_projectId_idx" ON "ticket" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX "ticket_issuerId_idx" ON "ticket" USING btree ("issuer_id");
--> statement-breakpoint
CREATE INDEX "ticket_status_idx" ON "ticket" USING btree ("status");
