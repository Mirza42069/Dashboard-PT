INSERT INTO "project_member" ("project_id", "user_id")
SELECT "project"."id", "user"."id"
FROM "project"
INNER JOIN "user" ON "user"."id" = "project"."manager_id"
WHERE "project"."manager_id" IS NOT NULL
  AND "user"."company_id" = "project"."company_id"
  AND "user"."role" = 'user'
  AND "user"."banned" = false
ON CONFLICT ("project_id", "user_id") DO NOTHING;
