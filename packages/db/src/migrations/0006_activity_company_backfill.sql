-- activity_log.company_id arrived nullable in 0005, so every row written before
-- companies existed is NULL. The feed filters with `company_id = $1`, and SQL
-- equality never matches NULL, so that history is written but permanently
-- invisible. File it under Company 1, which is where the pre-existing real data
-- was backfilled to in the same migration.
UPDATE "activity_log"
SET "company_id" = '11111111-1111-4111-8111-111111111111'
WHERE "company_id" IS NULL;
