CREATE TABLE "support_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"pathname" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "support_attachment_size_check" CHECK ("support_attachment"."size" > 0)
);
--> statement-breakpoint
ALTER TABLE "support_attachment" ADD CONSTRAINT "support_attachment_request_id_support_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."support_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_attachment_request_id_idx" ON "support_attachment" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_attachment_pathname_uidx" ON "support_attachment" USING btree ("pathname");