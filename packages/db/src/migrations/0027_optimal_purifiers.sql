CREATE TABLE "temporary_workbook_claim" (
	"pathname" text PRIMARY KEY NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "temporaryWorkbookClaim_claimedAt_idx" ON "temporary_workbook_claim" USING btree ("claimed_at");