-- "Company 1"/"Company 2" were placeholders chosen before the tenants were
-- named. Renamed here rather than by editing 0005, so the history stays honest
-- and a database already carrying the placeholder names is fixed by the same
-- statement that seeds a fresh one correctly.
--
-- Ids are the fixed UUIDs inserted by 0005; codes are unique, and BKU/SKN
-- cannot collide with the C1/C2 they replace.
UPDATE "company"
SET "name" = 'PT Bangun Karya Utama', "code" = 'BKU'
WHERE "id" = '11111111-1111-4111-8111-111111111111';
--> statement-breakpoint
UPDATE "company"
SET "name" = 'PT Sinar Konstruksi Nusantara', "code" = 'SKN'
WHERE "id" = '22222222-2222-4222-8222-222222222222';
--> statement-breakpoint
-- The seeded portfolio is realistic apart from the DEMO- code prefix, which is
-- the only thing marking it as filler. Strip it in place so existing rows match
-- what scripts/seed-demo.ts now generates.
UPDATE "project" SET "code" = 'PRJ-' || substring("code" from 6) WHERE "code" LIKE 'DEMO-%';
--> statement-breakpoint
UPDATE "material" SET "sku" = substring("sku" from 6) WHERE "sku" LIKE 'DEMO-%';
--> statement-breakpoint
UPDATE "equipment" SET "code" = 'EQ-' || substring("code" from 6) WHERE "code" LIKE 'DEMO-%';
