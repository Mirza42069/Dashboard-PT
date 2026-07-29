import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Tenant boundary.
 *
 * This lives in its own module rather than in construction.ts because both
 * ./auth.ts (user.companyId) and ./construction.ts (project) reference it, and
 * construction.ts already imports auth.ts — putting it in either one would
 * create an import cycle.
 *
 * Every root entity belongs to exactly one company, and a user sees exactly one
 * company at a time. Child rows — tickets, notes — carry no company of their
 * own; they inherit it through their parent, which is the only way it cannot
 * drift out of sync.
 */
export const company = pgTable("company", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
