import { expect, test } from "bun:test";
import type { DailyReportStatus } from "@DashboardV2/db/schema";

import { hasPermission } from "./permissions";
import {
  DAILY_REPORT_TRANSITIONS,
  canTransition,
  isEditable,
  permissionFor,
  requiresComment,
  stampFor,
} from "./daily-report-workflow";

/**
 * The daily-report rules, stated as tests. Same arrangement as the progress
 * workflow's: the router asks these functions and does what they say, so a rule
 * that is wrong here is wrong everywhere.
 */

const ALL: DailyReportStatus[] = ["draft", "submitted", "reviewed", "approved", "returned"];
const ACTOR = "user-1";
const NOW = new Date("2026-08-01T17:30:00Z");

test("a report runs draft to approved", () => {
  const path: DailyReportStatus[] = ["draft", "submitted", "reviewed", "approved"];
  for (let index = 0; index < path.length - 1; index++) {
    expect(canTransition(path[index]!, path[index + 1]!)).toBe(true);
  }
});

test("a reviewer may approve straight from submitted", () => {
  expect(canTransition("submitted", "approved")).toBe(true);
});

test("a report cannot skip straight from draft to approved", () => {
  expect(canTransition("draft", "approved")).toBe(false);
  expect(canTransition("draft", "reviewed")).toBe(false);
});

test("a returned report goes back to being written, or straight back in", () => {
  expect(canTransition("returned", "draft")).toBe(true);
  expect(canTransition("returned", "submitted")).toBe(true);
});

test("every status has an explicit transition list", () => {
  for (const status of ALL) expect(DAILY_REPORT_TRANSITIONS[status]).toBeDefined();
});

test("a report is editable while it is being written or after it comes back", () => {
  // Once submitted it is evidence: a delay claim or a safety finding is argued
  // from it later, and a version that could change after sign-off is worthless.
  expect(ALL.filter(isEditable)).toEqual(["draft", "returned"]);
});

test("submitting needs only project:write, judging needs progress:review", () => {
  expect(permissionFor("submitted", "draft")).toBe("project:write");
  expect(permissionFor("approved", "submitted")).toBe("progress:review");
  expect(permissionFor("returned", "submitted")).toBe("progress:review");
  expect(permissionFor("reviewed", "submitted")).toBe("progress:review");
});

test("reopening an approved day is a correction and needs the narrower grant", () => {
  expect(permissionFor("draft", "approved")).toBe("progress:lock");
  // Picking a returned report back up is ordinary work, not a correction.
  expect(permissionFor("draft", "returned")).toBe("project:write");
});

test("site staff can file a report but cannot approve their own", () => {
  expect(hasPermission("user", "project:write")).toBe(true);
  expect(hasPermission("user", "progress:review")).toBe(false);
});

test("returning a report, and reopening an approved one, demand a reason", () => {
  expect(requiresComment("returned", "submitted")).toBe(true);
  expect(requiresComment("draft", "approved")).toBe(true);
  expect(requiresComment("draft", "returned")).toBe(false);
  expect(requiresComment("submitted", "draft")).toBe(false);
});

test("returning clears the sign-off and records why", () => {
  const stamp = stampFor("returned", ACTOR, NOW, "Manpower does not match the gate log");
  expect(stamp.returnReason).toBe("Manpower does not match the gate log");
  expect(stamp.approvedById).toBeNull();
  expect(stamp.reviewedById).toBeNull();
});

test("reopening an approved day wipes every signature", () => {
  const stamp = stampFor("draft", ACTOR, NOW);
  for (const value of Object.values(stamp)) expect(value).toBeNull();
});

test("approving records the approver and drops a stale return reason", () => {
  const stamp = stampFor("approved", ACTOR, NOW);
  expect(stamp.approvedById).toBe(ACTOR);
  expect(stamp.approvedAt).toBe(NOW);
  expect(stamp.returnReason).toBeNull();
});

test("resubmitting clears the previous return reason", () => {
  // Otherwise a corrected report still displays the complaint it fixed.
  expect(stampFor("submitted", ACTOR, NOW).returnReason).toBeNull();
});
