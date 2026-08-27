ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "display_username" text;--> statement-breakpoint
WITH "candidate" AS (
	SELECT
		"id",
		CASE
			WHEN length(left(regexp_replace(split_part(lower("email"), '@', 1), '[^a-z0-9_.]', '_', 'g'), 30)) >= 3
				THEN left(regexp_replace(split_part(lower("email"), '@', 1), '[^a-z0-9_.]', '_', 'g'), 30)
			ELSE 'user_' || coalesce(nullif(regexp_replace(split_part(lower("email"), '@', 1), '[^a-z0-9_.]', '_', 'g'), ''), 'account')
		END AS "base"
	FROM "user"
), "ranked" AS (
	SELECT
		"id",
		"base",
		count(*) OVER (PARTITION BY "base") AS "matches"
	FROM "candidate"
)
UPDATE "user"
SET
	"username" = CASE
		WHEN "ranked"."matches" = 1 THEN "ranked"."base"
		ELSE left("ranked"."base", 17) || '_' || left(md5("user"."id"), 12)
	END,
	"display_username" = CASE
		WHEN "ranked"."matches" = 1 THEN "ranked"."base"
		ELSE left("ranked"."base", 17) || '_' || left(md5("user"."id"), 12)
	END
FROM "ranked"
WHERE "user"."id" = "ranked"."id";--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");
