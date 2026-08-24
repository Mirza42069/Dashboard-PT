import { describe, expect, test } from "bun:test";

import {
  canDeleteSupportRequest,
  nextSupportStatus,
  supportNoticeKindForAction,
} from "./support-policy";

describe("support request policy", () => {
  test("opens a thread and hands it to the requester", () => {
    expect(nextSupportStatus("new", "accept")).toBe("accepted");
    expect(nextSupportStatus("accepted", "reply")).toBe("answered");
  });

  test("passes the turn back and forth without limit", () => {
    // The point of the accepted/answered pair: a thread of any length walks
    // this loop, so neither side runs out of replies.
    let status = nextSupportStatus("new", "accept");
    expect(status).toBe("accepted");
    for (let round = 0; round < 5; round += 1) {
      status = nextSupportStatus(status!, "reply");
      expect(status).toBe("answered");
      status = nextSupportStatus(status!, "userReply");
      expect(status).toBe("accepted");
    }
  });

  test("closes from either side of the conversation", () => {
    expect(nextSupportStatus("accepted", "close")).toBe("closed");
    expect(nextSupportStatus("answered", "close")).toBe("closed");
  });

  test("lets either side speak twice without moving the turn", () => {
    // A follow-up thought should not have to wait for a reply that is not
    // coming, and saying more does not hand the thread over.
    expect(nextSupportStatus("answered", "reply")).toBe("answered");
    expect(nextSupportStatus("accepted", "userReply")).toBe("accepted");
  });

  test("adding to an untriaged request leaves it untriaged", () => {
    // Saying more is not the same as somebody picking it up.
    expect(nextSupportStatus("new", "userReply")).toBe("new");
  });

  test("rejects skipped, unsupported, and post-close actions", () => {
    expect(nextSupportStatus("new", "reply")).toBeNull();
    expect(nextSupportStatus("new", "close")).toBeNull();
    expect(nextSupportStatus("accepted", "accept")).toBeNull();
    expect(nextSupportStatus("answered", "accept")).toBeNull();
    // Closed is terminal from every direction.
    expect(nextSupportStatus("closed", "close")).toBeNull();
    expect(nextSupportStatus("closed", "userReply")).toBeNull();
    expect(nextSupportStatus("closed", "reply")).toBeNull();
    expect(nextSupportStatus("closed", "accept")).toBeNull();
  });

  test("maps each notified transition to its replacement notice kind", () => {
    expect(supportNoticeKindForAction("accept")).toBe("support_accepted");
    expect(supportNoticeKindForAction("reply")).toBe("support_replied");
    expect(supportNoticeKindForAction("close")).toBe("support_closed");
  });

  test("sends no notice for a requester's own message", () => {
    // The notices are addressed to the requester; support watches the inbox.
    expect(supportNoticeKindForAction("userReply")).toBeNull();
  });

  test("only permanently deletes closed requests", () => {
    expect(canDeleteSupportRequest("new")).toBe(false);
    expect(canDeleteSupportRequest("accepted")).toBe(false);
    expect(canDeleteSupportRequest("answered")).toBe(false);
    expect(canDeleteSupportRequest("closed")).toBe(true);
  });
});
