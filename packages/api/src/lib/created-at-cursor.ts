import { sql, type SQLWrapper } from "drizzle-orm";
import z from "zod";

export const createdAtCursorSchema = z.object({
  createdAt: z.iso.datetime({ precision: 6 }),
  id: z.string().min(1),
});

export type CreatedAtCursor = z.infer<typeof createdAtCursorSchema>;

/** Keep PostgreSQL's microseconds instead of round-tripping through a JS Date. */
export function exactCursorTimestamp(createdAt: SQLWrapper) {
  return sql<string>`to_char(${createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function createdAtCursorCondition(
  createdAt: SQLWrapper,
  id: SQLWrapper,
  cursor: CreatedAtCursor,
  inclusive = false,
) {
  return inclusive
    ? sql`(${createdAt}, ${id}) <= (${cursor.createdAt}::timestamp, ${cursor.id})`
    : sql`(${createdAt}, ${id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`;
}
