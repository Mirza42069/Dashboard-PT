UPDATE "project"
SET "manager_id" = NULL
WHERE "manager_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "user"
    WHERE "user"."id" = "project"."manager_id"
      AND "user"."company_id" = "project"."company_id"
      AND "user"."role" IN ('admin', 'user')
  );
--> statement-breakpoint
DELETE FROM "project_member"
USING "project", "user"
WHERE "project_member"."project_id" = "project"."id"
  AND "project_member"."user_id" = "user"."id"
  AND (
    "user"."company_id" IS DISTINCT FROM "project"."company_id"
    OR "user"."role" IS DISTINCT FROM 'user'
  );
--> statement-breakpoint
INSERT INTO "project_member" ("project_id", "user_id")
SELECT "project"."id", "user"."id"
FROM "project"
INNER JOIN "user" ON "user"."id" = "project"."manager_id"
WHERE "project"."manager_id" IS NOT NULL
  AND "user"."company_id" = "project"."company_id"
  AND "user"."role" = 'user'
  AND "user"."banned" = false
ON CONFLICT ("project_id", "user_id") DO NOTHING;
