-- activity_log rows for these entities are deliberately kept. The table holds no
-- foreign key to its entity precisely so history outlives what it describes (see
-- the comment on activityLog in ../schema/construction.ts), and the feed already
-- renders unknown entity/action pairs through t.activity.sentence.fallback.
DROP TABLE "equipment" CASCADE;--> statement-breakpoint
DROP TABLE "expense" CASCADE;--> statement-breakpoint
DROP TABLE "material" CASCADE;--> statement-breakpoint
DROP TABLE "material_movement" CASCADE;