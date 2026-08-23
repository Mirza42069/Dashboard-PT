import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";

import { assertNotArchived } from "./archived";

/**
 * The invariant the whole read-only-while-archived behaviour rests on.
 *
 * Every write path reaches this through one of five resolvers
 * (assertProjectWritable, getWritableVersion, requireDraftForItem,
 * findReportForWrite, ticketInScopeForWrite), so if this is wrong they are all
 * wrong together.
 */
describe("assertNotArchived", () => {
  test("a live project passes", () => {
    expect(() => assertNotArchived(null)).not.toThrow();
  });

  test("an archived project is refused", () => {
    expect(() => assertNotArchived(new Date("2026-08-23T00:00:00Z"))).toThrow(TRPCError);
  });

  test("the epoch is still a timestamp, not an absence", () => {
    // `new Date(0)` is falsy-adjacent in a way that a truthiness check would get
    // wrong; the guard tests against null explicitly for this reason.
    expect(() => assertNotArchived(new Date(0))).toThrow(TRPCError);
  });

  test("it refuses with CONFLICT, not FORBIDDEN", () => {
    // FORBIDDEN would read as "you lack permission" and send the reader to an
    // admin, when what they need is the restore button.
    try {
      assertNotArchived(new Date());
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("CONFLICT");
    }
  });

  test("the entity name reaches the message", () => {
    try {
      assertNotArchived(new Date(), "note");
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as TRPCError).message).toContain("note");
    }
  });
});
