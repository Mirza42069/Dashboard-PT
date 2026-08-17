CREATE TABLE "workbook_request_limit" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"window_started_at" timestamp DEFAULT now() NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workbook_request_limit_user_id_scope_pk" PRIMARY KEY("user_id","scope"),
	CONSTRAINT "workbook_request_limit_count_check" CHECK ("workbook_request_limit"."request_count" > 0)
);
--> statement-breakpoint
ALTER TABLE "workbook_request_limit" ADD CONSTRAINT "workbook_request_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workbookRequestLimit_window_idx" ON "workbook_request_limit" USING btree ("window_started_at");