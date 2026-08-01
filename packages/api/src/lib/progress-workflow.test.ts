import { expect, test } from "bun:test";
import type { PeriodStatus } from "@DashboardV2/db/schema";

import { hasPermission } from "./permissions";
import {
  PERIOD_TRANSITIONS,
  canTransition,
  completeness,
  isApproved,
  isEditable,
  permissionFor,
  requiresComment,
  stampFor,
} from "./progress-workflow";

/**
 * The workflow rules, stated as tests.
 *
 * These are the specification. The router does no state reasoning of its own —
 * it asks `canTransition`, `permissionFor` and `requiresComment` and does what
 * they say — so a rule that is wrong here is wrong everywhere.
 */

const ALL: PeriodStatus[] = [
  "open",
  "draft",
  "submitted",
  "reviewed",
  "approved",
  "returned",
  "locked",
];

const ACTOR = "user-1";
const NOW = new Date("2026-08-01T09:00:00Z");

test("the happy path runs open to locked", () => {
  const path: PeriodStatus[] = ["open", "draft", "submitted", "reviewed", "approved", "locked"];
  for (let index = 0; index < path.length - 1; index++) {
    expect(canTransition(path[index]!, path[index + 1]!)).toBe(true);
  }
});

test("a reviewer may approve straight from submitted, skipping the review step", () => {
  expect(canTransition("submitted", "approved")).toBe(true);
});

test("figures cannot skip the workflow", () => {
  // No jumping from being written straight to agreed.
  expect(canTransition("draft", "approved")).toBe(false);
  expect(canTransition("open", "submitted")).toBe(false);
  expect(canTransition("draft", "locked")).toBe(false);
  // And nothing goes back to untouched.
  for (const from of ALL) expect(canTransition(from, "open")).toBe(false);
});

test("every status has an explicit transition list, so a new one cannot be forgotten", () => {
  for (const status of ALL) {
    expect(PERIOD_TRANSITIONS[status]).toBeDefined();
  }
});

test("a report is editable only before it has been submitted, or after it comes back", () => {
  expect(ALL.filter(isEditable)).toEqual(["open", "draft", "returned"]);
});

test("submitted and reviewed reports are frozen while somebody reads them", () => {
  // The reviewer must approve the figures they were shown, not the ones that
  // were edited underneath them.
  expect(isEditable("submitted")).toBe(false);
  expect(isEditable("reviewed")).toBe(false);
});

test("approved and locked both count as agreed", () => {
  expect(ALL.filter(isApproved)).toEqual(["approved", "locked"]);
});

/* ----------------------------------------------------------- permissions */

test("entering and submitting figures needs only project:write", () => {
  expect(permissionFor("draft", "open")).toBe("project:write");
  expect(permissionFor("submitted", "draft")).toBe("project:write");
  expect(permissionFor("submitted", "returned")).toBe("project:write");
});

test("judging a report needs progress:review", () => {
  expect(permissionFor("reviewed", "submitted")).toBe("progress:review");
  expect(permissionFor("approved", "submitted")).toBe("progress:review");
  expect(permissionFor("returned", "submitted")).toBe("progress:review");
});

test("locking and reopening an agreed period need progress:lock", () => {
  expect(permissionFor("locked", "approved")).toBe("progress:lock");
  expect(permissionFor("draft", "approved")).toBe("progress:lock");
  expect(permissionFor("draft", "locked")).toBe("progress:lock");
});

test("a site user can record and submit but cannot sign off their own report", () => {
  // The separation the workflow exists for: if one role could do both, the
  // review step would be a formality performed by the person being reviewed.
  expect(hasPermission("user", "project:write")).toBe(true);
  expect(hasPermission("user", "progress:review")).toBe(false);
  expect(hasPermission("user", "progress:lock")).toBe(false);
  expect(hasPermission("admin", "progress:review")).toBe(true);
  expect(hasPermission("admin", "progress:lock")).toBe(true);
});

/* -------------------------------------------------------------- comments */

test("sending a report back demands a reason", () => {
  expect(requiresComment("returned", "submitted")).toBe(true);
  expect(requiresComment("returned", "reviewed")).toBe(true);
});

test("reopening an agreed period demands a reason, but ordinary editing does not", () => {
  expect(requiresComment("draft", "approved")).toBe(true);
  expect(requiresComment("draft", "locked")).toBe(true);
  expect(requiresComment("draft", "returned")).toBe(false);
  expect(requiresComment("submitted", "draft")).toBe(false);
});

/* ---------------------------------------------------------------- stamps */

test("submitting records the submitter and clears any earlier sign-off", () => {
  const stamp = stampFor("submitted", ACTOR, NOW);
  expect(stamp.submittedById).toBe(ACTOR);
  expect(stamp.submittedAt).toBe(NOW);
  expect(stamp.approvedById).toBeNull();
  expect(stamp.returnReason).toBeNull();
});

test("returning a report clears the approval but keeps the submission on record", () => {
  const stamp = stampFor("returned", ACTOR, NOW, "Piling quantities look transposed");

  expect(stamp.returnReason).toBe("Piling quantities look transposed");
  expect(stamp.approvedById).toBeNull();
  expect(stamp.approvedAt).toBeNull();
  expect(stamp.lockedById).toBeNull();
  // Who submitted it is not touched — the reviewer is rejecting that person's
  // report, and the record of who filed it is exactly what is being acted on.
  expect(stamp.submittedById).toBeUndefined();
});

test("reopening for correction wipes every signature", () => {
  const stamp = stampFor("draft", ACTOR, NOW);
  for (const value of Object.values(stamp)) expect(value).toBeNull();
});

test("approving records the approver and drops any stale return reason", () => {
  const stamp = stampFor("approved", ACTOR, NOW, "Agreed at site meeting");
  expect(stamp.approvedById).toBe(ACTOR);
  expect(stamp.reviewComment).toBe("Agreed at site meeting");
  expect(stamp.returnReason).toBeNull();
});

/* ---------------------------------------------------------- completeness */

const line = (boqItemId: string, hasReading: boolean, noProgress = false) => ({
  boqItemId,
  hasReading,
  noProgress,
});

test("a line is addressed by a reading or by an explicit no-progress mark", () => {
  const summary = completeness(4, [line("a", true), line("b", false, true)]);
  expect(summary).toEqual({ total: 4, reported: 1, noProgress: 1, missing: 2 });
});

test("a blank line counts as missing, not as zero progress", () => {
  // The whole reason the flag exists: nothing here distinguishes "the piling
  // did not move" from "nobody looked at the piling" except somebody saying so.
  expect(completeness(3, []).missing).toBe(3);
  expect(completeness(3, [line("a", false, false)]).missing).toBe(3);
});

test("a reading supersedes a no-progress mark on the same line", () => {
  const summary = completeness(1, [line("a", true, true)]);
  expect(summary.reported).toBe(1);
  expect(summary.noProgress).toBe(0);
  expect(summary.missing).toBe(0);
});

test("a report with every line addressed has nothing missing", () => {
  const summary = completeness(2, [line("a", true), line("b", false, true)]);
  expect(summary.missing).toBe(0);
});

test("entries for lines outside the baseline cannot drive missing below zero", () => {
  const summary = completeness(1, [line("a", true), line("stale", true)]);
  expect(summary.missing).toBe(0);
});
