CREATE TABLE "support_message" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"body" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_side" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_message_author_side_check" CHECK ("support_message"."author_side" in ('requester', 'support'))
);
--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_request_id_support_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_message" ADD CONSTRAINT "support_message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_message_request_created_idx" ON "support_message" USING btree ("request_id","created_at");--> statement-breakpoint
-- Carry the single reply each existing request could hold into the transcript,
-- so threads that were answered before this migration still read as a
-- conversation rather than opening empty under their opening message.
INSERT INTO "support_message" ("id", "request_id", "body", "author_id", "author_name", "author_side", "created_at")
SELECT
	-- Derived from the request rather than generated: there is exactly one of
	-- these per request, so it is unique without depending on a uuid function
	-- being available, and re-running the statement cannot duplicate a row.
	'backfill-reply-' || "id",
	"id",
	"final_reply",
	"replied_by_id",
	coalesce("replied_by_name", 'Support'),
	'support',
	coalesce("replied_at", "updated_at")
FROM "support_request"
WHERE "final_reply" IS NOT NULL;
