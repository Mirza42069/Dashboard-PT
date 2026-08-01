import type { PeriodStatus } from "@DashboardV2/db/schema";

import type { Permission } from "./permissions";

/**
 * The reporting-period state machine.
 *
 * One table of legal moves, in one file with no database import, so the rules
 * can be read in full and tested directly. Every transition the API performs
 * goes through `canTransition` — there is no path that writes a status without
 * asking here first, which is what makes "prevent invalid state transitions
 * server-side" a property of the code rather than a promise.
 *
 *      open ──save──> draft ──submit──> submitted ──┬─review─> reviewed ──┐
 *                       ↑                            │                     ├─approve─> approved ──lock──> locked
 *                    returned <────return────────────┴─────────────────────┘              │                  │
 *                       ↑                                                                  └──── reopen ─────┘
 *                       └────────────────── reopen (with reason) ────────────────────────────────┘
 *
 * Two decisions worth keeping:
 *
 * 1. **`reviewed` is optional.** A reviewer may approve straight from
 *    `submitted`. Forcing an intermediate step on a two-person contractor
 *    would mean everyone clicks through it, which teaches people that the
 *    workflow is ceremony.
 *
 * 2. **Approved and locked are both reversible, but only through `reopen`.**
 *    A late correction to an agreed period is a normal thing to need on a site;
 *    pretending otherwise gets it done in a spreadsheet instead. What the
 *    workflow insists on is that reopening is a named, permissioned, reasoned
 *    act that lands in the history — not an edit that quietly happens.
 */

export const PERIOD_TRANSITIONS: Record<PeriodStatus, readonly PeriodStatus[]> = {
  open: ["draft"],
  draft: ["submitted"],
  returned: ["draft", "submitted"],
  submitted: ["reviewed", "approved", "returned"],
  reviewed: ["approved", "returned"],
  approved: ["locked", "draft"],
  locked: ["draft"],
};

export function canTransition(from: PeriodStatus, to: PeriodStatus): boolean {
  return PERIOD_TRANSITIONS[from].includes(to);
}

/**
 * Whether readings may be written into a period in this state.
 *
 * A submitted report is somebody's statement of record; letting the figures
 * move underneath it while a reviewer reads them is how a reviewer ends up
 * approving numbers they never saw. Getting back to editable means being
 * returned, or being reopened.
 */
export function isEditable(status: PeriodStatus): boolean {
  return status === "open" || status === "draft" || status === "returned";
}

/** Statuses where the figures are settled and count as agreed. */
export function isApproved(status: PeriodStatus): boolean {
  return status === "approved" || status === "locked";
}

/**
 * Who may perform a move.
 *
 * Submitting is part of doing the work, so it sits under the same permission as
 * entering the figures. Judging the work is separate: reviewing, approving and
 * returning need `progress:review`, and locking or reopening an agreed period
 * needs `progress:lock`, which is the narrower grant of the two.
 */
export function permissionFor(to: PeriodStatus, from: PeriodStatus): Permission {
  if (to === "draft") {
    // Back into editing from an agreed state is a correction, not a save.
    return isApproved(from) ? "progress:lock" : "project:write";
  }
  if (to === "submitted") return "project:write";
  if (to === "locked") return "progress:lock";
  return "progress:review";
}

/**
 * The actor/timestamp columns a transition writes.
 *
 * Steps forward stamp themselves; steps backward clear everything from the step
 * they land on onwards, so a returned report does not still name an approver
 * and a reopened one does not still claim to be locked. Returning the whole
 * patch from one place is what stops that clearing being forgotten at one of
 * the four call sites.
 */
export type WorkflowStamp = {
  submittedById?: string | null;
  submittedAt?: Date | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  lockedById?: string | null;
  lockedAt?: Date | null;
  returnReason?: string | null;
  reviewComment?: string | null;
};

export function stampFor(
  to: PeriodStatus,
  actorId: string,
  now: Date,
  comment?: string | null,
): WorkflowStamp {
  const cleared: WorkflowStamp = {
    submittedById: null,
    submittedAt: null,
    reviewedById: null,
    reviewedAt: null,
    approvedById: null,
    approvedAt: null,
    lockedById: null,
    lockedAt: null,
    returnReason: null,
    reviewComment: null,
  };

  switch (to) {
    case "draft":
      // Everything is cleared: the report being edited again is not the report
      // that was submitted, and none of the earlier signatures apply to it.
      return cleared;
    case "submitted":
      return { ...cleared, submittedById: actorId, submittedAt: now };
    case "reviewed":
      return { reviewedById: actorId, reviewedAt: now, reviewComment: comment ?? null };
    case "approved":
      return {
        approvedById: actorId,
        approvedAt: now,
        reviewComment: comment ?? null,
        returnReason: null,
      };
    case "returned":
      return {
        reviewedById: null,
        reviewedAt: null,
        approvedById: null,
        approvedAt: null,
        lockedById: null,
        lockedAt: null,
        returnReason: comment ?? null,
      };
    case "locked":
      return { lockedById: actorId, lockedAt: now };
    default:
      return {};
  }
}

/** Transitions that cannot be performed without an explanation. */
export function requiresComment(to: PeriodStatus, from: PeriodStatus): boolean {
  if (to === "returned") return true;
  // Reopening an agreed period: the reason is the whole point of the audit row.
  return to === "draft" && isApproved(from);
}

export type LineCompleteness = {
  /** Schedulable lines in the active baseline. */
  total: number;
  /** Lines with a reading in this period. */
  reported: number;
  /** Lines explicitly marked as unchanged. */
  noProgress: number;
  /** Lines nobody has addressed either way. */
  missing: number;
};

/**
 * Whether a period is complete enough to submit.
 *
 * Every schedulable line must be *addressed* — given a reading, or explicitly
 * marked as unchanged. That distinction is the whole point: a blank cell is
 * indistinguishable from a line somebody forgot, and a report submitted with
 * forgotten lines silently understates progress and overstates delay.
 */
export function completeness(
  totalLines: number,
  entries: { boqItemId: string; hasReading: boolean; noProgress: boolean }[],
): LineCompleteness {
  const reported = new Set<string>();
  const unchanged = new Set<string>();

  for (const entry of entries) {
    if (entry.hasReading) reported.add(entry.boqItemId);
    else if (entry.noProgress) unchanged.add(entry.boqItemId);
  }

  // A line with both is counted as reported — the reading is the stronger claim.
  for (const id of reported) unchanged.delete(id);

  return {
    total: totalLines,
    reported: reported.size,
    noProgress: unchanged.size,
    missing: Math.max(0, totalLines - reported.size - unchanged.size),
  };
}
