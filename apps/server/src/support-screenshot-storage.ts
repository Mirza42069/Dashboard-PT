import { db } from "@DashboardV2/db";
import { supportAttachment } from "@DashboardV2/db/schema";
import { del, list } from "@vercel/blob";
import { inArray } from "drizzle-orm";

const PREFIX = "support-screenshots/";
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

/** Removes direct uploads that were never linked to a submitted support request. */
export async function purgeAbandonedSupportScreenshots(now = Date.now()) {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    const expired = page.blobs.filter(
      (blob) => now - blob.uploadedAt.getTime() >= ABANDONED_AFTER_MS,
    );
    if (expired.length > 0) {
      const pathnames = expired.map((blob) => blob.pathname);
      const attached = await db
        .select({ pathname: supportAttachment.pathname })
        .from(supportAttachment)
        .where(inArray(supportAttachment.pathname, pathnames));
      const retained = new Set(attached.map(({ pathname }) => pathname));
      const abandoned = pathnames.filter((pathname) => !retained.has(pathname));
      if (abandoned.length > 0) {
        await del(abandoned);
        deleted += abandoned.length;
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}
