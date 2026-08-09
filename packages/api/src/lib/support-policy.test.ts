import { describe, expect, test } from "bun:test";

import { nextSupportStatus, supportNoticeKindForAction } from "./support-policy";

describe("support request policy", () => {
  test("follows the support lifecycle in order", () => {
    expect(nextSupportStatus("new", "accept")).toBe("accepted");
    expect(nextSupportStatus("accepted", "reply")).toBe("answered");
    expect(nextSupportStatus("answered", "close")).toBe("closed");
  });

  test("rejects skipped, repeated, and post-close actions", () => {
    expect(nextSupportStatus("new", "reply")).toBeNull();
    expect(nextSupportStatus("new", "close")).toBeNull();
    expect(nextSupportStatus("accepted", "accept")).toBeNull();
    expect(nextSupportStatus("answered", "reply")).toBeNull();
    expect(nextSupportStatus("closed", "close")).toBeNull();
  });

  test("maps each transition to its single replacement notice kind", () => {
    expect(supportNoticeKindForAction("accept")).toBe("support_accepted");
    expect(supportNoticeKindForAction("reply")).toBe("support_replied");
    expect(supportNoticeKindForAction("close")).toBe("support_closed");
  });
});
