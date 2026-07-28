CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_code_unique" UNIQUE("code")
);
--> statement-breakpoint
-- Fixed ids so the backfill below can reference them without a round trip.
INSERT INTO "company" ("id", "name", "code") VALUES
  ('11111111-1111-4111-8111-111111111111', 'Company 1', 'C1'),
  ('22222222-2222-4222-8222-222222222222', 'Company 2', 'C2');
--> statement-breakpoint
-- Codes are unique per company now, not globally: two tenants may both run a
-- "PRJ-001", and the demo seed uses the same DEMO- codes in either company.
ALTER TABLE "equipment" DROP CONSTRAINT "equipment_code_unique";--> statement-breakpoint
ALTER TABLE "material" DROP CONSTRAINT "material_sku_unique";--> statement-breakpoint
ALTER TABLE "project" DROP CONSTRAINT "project_code_unique";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "company_id" text;--> statement-breakpoint
-- Added nullable, backfilled, then tightened: ADD COLUMN ... NOT NULL cannot
-- work on a populated table without a default, and a default would be wrong here.
ALTER TABLE "equipment" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "material" ADD COLUMN "company_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "company_id" text;--> statement-breakpoint
-- Demo rows go to Company 2, everything hand-entered to Company 1.
UPDATE "project" SET "company_id" = CASE WHEN "code" LIKE 'DEMO-%'
  THEN '22222222-2222-4222-8222-222222222222'
  ELSE '11111111-1111-4111-8111-111111111111' END;--> statement-breakpoint
UPDATE "material" SET "company_id" = CASE WHEN "sku" LIKE 'DEMO-%'
  THEN '22222222-2222-4222-8222-222222222222'
  ELSE '11111111-1111-4111-8111-111111111111' END;--> statement-breakpoint
UPDATE "equipment" SET "company_id" = CASE WHEN "code" LIKE 'DEMO-%'
  THEN '22222222-2222-4222-8222-222222222222'
  ELSE '11111111-1111-4111-8111-111111111111' END;--> statement-breakpoint
-- A cross-company link would leak one tenant's rows into the other's views via
-- the join. Detach the few that the prefix split could have straddled.
UPDATE "equipment" e SET "project_id" = NULL
  FROM "project" p WHERE e."project_id" = p."id" AND e."company_id" <> p."company_id";--> statement-breakpoint
UPDATE "material_movement" mm SET "project_id" = NULL
  FROM "material" m, "project" p
  WHERE mm."material_id" = m."id" AND mm."project_id" = p."id"
    AND m."company_id" <> p."company_id";--> statement-breakpoint
ALTER TABLE "equipment" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "material" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
-- Admins stay unpinned (they pick an active company); everyone else lands in
-- Company 1, which is where the existing real data went.
UPDATE "user" SET "company_id" = '11111111-1111-4111-8111-111111111111'
  WHERE "role" <> 'admin';--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activityLog_companyId_idx" ON "activity_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "equipment_companyId_idx" ON "equipment" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "material_companyId_idx" ON "material" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "project_companyId_idx" ON "project" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_companyId_code_key" UNIQUE("company_id","code");--> statement-breakpoint
ALTER TABLE "material" ADD CONSTRAINT "material_companyId_sku_key" UNIQUE("company_id","sku");--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_companyId_code_key" UNIQUE("company_id","code");
