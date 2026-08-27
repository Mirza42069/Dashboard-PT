-- 0037 was applied to the first target database before account names were
-- restricted to a cross-runtime normalization contract. Repeat the finalized
-- repair there; fresh databases also run this safely after 0036 and 0037.
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS "user_username_unique";--> statement-breakpoint
WITH RECURSIVE "normalized_accounts" AS (
	SELECT
		"id",
		regexp_replace(btrim("name"), ' +', ' ', 'g') AS "normalized_name",
		"name" COLLATE "C" ~ '^[ -~]+$'
			AND strpos("name", '@') = 0
			AND char_length(regexp_replace(btrim("name"), ' +', ' ', 'g')) BETWEEN 1 AND 120
			AS "source_valid"
	FROM "user"
),
"ranked_accounts" AS (
	SELECT
		"id",
		"normalized_name",
		"source_valid",
		row_number() OVER (
			PARTITION BY translate("normalized_name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
			ORDER BY "id"
		) AS "duplicate_rank"
	FROM "normalized_accounts"
),
"classified_accounts" AS (
	SELECT
		"id",
		"normalized_name",
		"source_valid" AND "duplicate_rank" = 1 AS "keep_name"
	FROM "ranked_accounts"
),
"repair_queue" AS (
	SELECT
		"id",
		row_number() OVER (ORDER BY "id") AS "repair_index"
	FROM "classified_accounts"
	WHERE NOT "keep_name"
),
"initial_names" AS (
	SELECT coalesce(array_agg(translate("normalized_name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')), ARRAY[]::text[]) AS "used_names"
	FROM "classified_accounts"
	WHERE "keep_name"
),
"assigned_accounts"("repair_index", "id", "account_name", "used_names") AS (
	SELECT 0::bigint, NULL::text, NULL::text, "used_names"
	FROM "initial_names"
	UNION ALL
	SELECT
		"repair_queue"."repair_index",
		"repair_queue"."id",
		"candidate"."account_name",
		"assigned_accounts"."used_names" || translate("candidate"."account_name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')
	FROM "assigned_accounts"
	JOIN "repair_queue"
		ON "repair_queue"."repair_index" = "assigned_accounts"."repair_index" + 1
	CROSS JOIN LATERAL (
		SELECT 'Account ' || "generated"."value" AS "account_name"
		FROM generate_series(
			1::bigint,
			(SELECT count(*)::bigint + 1 FROM "normalized_accounts")
		) AS "generated"("value")
		WHERE NOT translate('Account ' || "generated"."value", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') = ANY("assigned_accounts"."used_names")
		ORDER BY "generated"."value"
		LIMIT 1
	) AS "candidate"
),
"resolved_accounts" AS (
	SELECT "id", "normalized_name" AS "account_name"
	FROM "classified_accounts"
	WHERE "keep_name"
	UNION ALL
	SELECT "id", "account_name"
	FROM "assigned_accounts"
	WHERE "id" IS NOT NULL
)
UPDATE "user" AS "account"
SET
	"name" = "resolved_accounts"."account_name",
	"username" = translate("resolved_accounts"."account_name", 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
	"display_username" = "resolved_accounts"."account_name"
FROM "resolved_accounts"
WHERE "account"."id" = "resolved_accounts"."id";--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "display_username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");
