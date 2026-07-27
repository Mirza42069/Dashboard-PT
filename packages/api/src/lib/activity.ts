import { db } from "@DashboardV2/db";
import { activityLog } from "@DashboardV2/db/schema";
import type { ActivityAction, ActivityEntity } from "@DashboardV2/db/schema";

import type { Context } from "../context";

export type ActivityInput = {
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  /** Human label captured now — the entity may not exist when this is read. */
  entityLabel: string;
  detail?: string;
};

/**
 * Appends one row to the audit trail.
 *
 * Two properties this must have:
 *
 * 1. **It can never break the action it records.** The Neon HTTP driver has no
 *    interactive transactions, so this runs after the real write and cannot be
 *    rolled into it. A failed audit insert therefore only warns — turning a
 *    successful project creation into a user-visible error because the log
 *    hiccuped would be strictly worse than losing one log row.
 *
 * 2. **It stores labels, not references.** Callers pass a label built from data
 *    they already hold. Looking the entity up afterwards would return nothing
 *    for exactly the events that matter most — deletions.
 */
export async function recordActivity(
  ctx: Pick<Context, "session">,
  input: ActivityInput,
): Promise<void> {
  try {
    await db.insert(activityLog).values({
      actorId: ctx.session?.user.id ?? null,
      actorName: ctx.session?.user.name ?? "System",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      detail: input.detail,
    });
  } catch (error) {
    console.warn(
      `[activity] failed to record ${input.entityType}.${input.action}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
