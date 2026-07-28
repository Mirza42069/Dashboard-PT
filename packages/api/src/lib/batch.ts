import { db } from "@DashboardV2/db";
import type { BatchItem } from "drizzle-orm/batch";

/**
 * Runs several statements as one unit.
 *
 * The Neon HTTP driver has no interactive transactions — you cannot open one,
 * read, decide, and write. It does support a *batch*: a fixed list of
 * statements sent together and committed together. That is enough for every
 * multi-statement write in the BoQ module, because in each case the statements
 * are known up front and none of them needs to see the results of an earlier
 * one.
 *
 * The cast exists only because drizzle types the batch as a non-empty tuple,
 * which a conditionally built array cannot satisfy; the length check above it
 * is what actually makes that safe.
 */
export async function runBatch(statements: BatchItem<"pg">[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
}
