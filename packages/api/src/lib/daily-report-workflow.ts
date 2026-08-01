import type { DailyReportStatus } from "@DashboardV2/db/schema";

import type { Permission } from "./permissions";

/**
 * The daily-report state machine.
 *
 * Deliberately the same shape as lib/progress-workflow.ts — one transition
 * table, one permission function, one stamp function, no state reasoning in the
 * router — but a separate machine rather than a shared generic one. The two
 * differ in ways a shared abstraction would have to be parameterised around
 * anyway (there is no `open` here: a daily report does not exist until somebody
 * starts writing it, and there is no `locked` because a day's record is closed
 * by approval, not by a further step), and a "flexible" workflow engine is
 * exactly the speculative abstraction that makes both harder to read.
 *
 *   draft ──submit──> submitted ──┬── review ──> reviewed ──┐
 *     ↑                            │                         ├── approve ──> approved
 *   returned <────── return ───────┴─────────────────────────┘                   │
 *     └──────────────────────── reopen ─────────────────────────────────────────┘
 */
export const DAILY_REPORT_TRANSITIONS: Record<DailyReportStatus, readonly DailyReportStatus[]> = {
  draft: ["submitted"],
  returned: ["draft", "submitted"],
  submitted: ["reviewed", "approved", "returned"],
  reviewed: ["approved", "returned"],
  // Reopening an approved day is a correction and is recorded as one.
  approved: ["draft"],
};

export function canTransition(from: DailyReportStatus, to: DailyReportStatus): boolean {
  return DAILY_REPORT_TRANSITIONS[from].includes(to);
}

/**
 * A report is editable while it is being written or after it comes back.
 *
 * Once submitted it is frozen, for the reason a progress report is: the
 * reviewer must be approving the account they were shown. A daily report is
 * also evidence — it is what a delay or a safety finding is later argued from —
 * so a version that could change after sign-off would be worth nothing.
 */
export function isEditable(status: DailyReportStatus): boolean {
  return status === "draft" || status === "returned";
}

export function permissionFor(to: DailyReportStatus, from: DailyReportStatus): Permission {
  if (to === "submitted") return "project:write";
  // Back to editable from approved is a correction, not a save.
  if (to === "draft") return from === "approved" ? "progress:lock" : "project:write";
  return "progress:review";
}

/** Returning a report, or reopening an approved one, needs an explanation. */
export function requiresComment(to: DailyReportStatus, from: DailyReportStatus): boolean {
  return to === "returned" || (to === "draft" && from === "approved");
}

export type DailyReportStamp = {
  submittedAt?: Date | null;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  approvedById?: string | null;
  approvedAt?: Date | null;
  returnReason?: string | null;
};

export function stampFor(
  to: DailyReportStatus,
  actorId: string,
  now: Date,
  comment?: string | null,
): DailyReportStamp {
  switch (to) {
    case "draft":
      // A reopened report is not the report that was approved; none of the
      // earlier signatures apply to whatever it becomes.
      return {
        submittedAt: null,
        reviewedById: null,
        reviewedAt: null,
        approvedById: null,
        approvedAt: null,
        returnReason: null,
      };
    case "submitted":
      return { submittedAt: now, returnReason: null };
    case "reviewed":
      return { reviewedById: actorId, reviewedAt: now };
    case "approved":
      return { approvedById: actorId, approvedAt: now, returnReason: null };
    case "returned":
      return {
        reviewedById: null,
        reviewedAt: null,
        approvedById: null,
        approvedAt: null,
        returnReason: comment ?? null,
      };
    default:
      return {};
  }
}
