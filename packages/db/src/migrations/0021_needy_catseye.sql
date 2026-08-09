CREATE TABLE "support_request" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"requester_id" text,
	"requester_name" text NOT NULL,
	"requester_email" text NOT NULL,
	"company_id" text,
	"company_name" text NOT NULL,
	"company_code" text NOT NULL,
	"accepted_by_id" text,
	"accepted_by_name" text,
	"accepted_at" timestamp,
	"final_reply" text,
	"replied_by_id" text,
	"replied_by_name" text,
	"replied_at" timestamp,
	"closed_by_id" text,
	"closed_by_name" text,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_request_status_check" CHECK ("support_request"."status" in ('new', 'accepted', 'answered', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_requester_id_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_accepted_by_id_user_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_replied_by_id_user_id_fk" FOREIGN KEY ("replied_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_request" ADD CONSTRAINT "support_request_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_request_created_at_id_idx" ON "support_request" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "support_request_status_created_at_id_idx" ON "support_request" USING btree ("status","created_at","id");