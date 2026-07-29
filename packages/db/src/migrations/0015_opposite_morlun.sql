DELETE FROM "activity_log" WHERE "entity_type" IN ('material', 'equipment', 'expense');--> statement-breakpoint
DROP TABLE "equipment" CASCADE;--> statement-breakpoint
DROP TABLE "expense" CASCADE;--> statement-breakpoint
DROP TABLE "material" CASCADE;--> statement-breakpoint
DROP TABLE "material_movement" CASCADE;