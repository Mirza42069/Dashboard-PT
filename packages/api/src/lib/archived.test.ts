import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";

import { assertNotArchived } from "./archived";
import { dictionaryFor } from "./messages/index";

/**
 * The invariant the whole read-only-while-archived behaviour rests on.
 *
 * Every write path reaches this through one of four resolvers
 * (assertProjectWritable, getWritableVersion, requireDraftForItem,
 * ticketInScopeForWrite), so if this is wrong they are all
 * wrong together.
 */
const t = dictionaryFor("id");

/** The message of the TRPCError `run` is expected to throw. */
function messageFrom(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof TRPCError) return error.message;
  }
  throw new Error("expected a TRPCError");
}

describe("assertNotArchived", () => {
  test("a live project passes", () => {
    expect(() => assertNotArchived(t, null)).not.toThrow();
  });

  test("an archived project is refused", () => {
    expect(() => assertNotArchived(t, new Date("2026-08-23T00:00:00Z"))).toThrow(TRPCError);
  });

  test("the epoch is still a timestamp, not an absence", () => {
    // `new Date(0)` is falsy-adjacent in a way that a truthiness check would get
    // wrong; the guard tests against null explicitly for this reason.
    expect(() => assertNotArchived(t, new Date(0))).toThrow(TRPCError);
  });

  test("it refuses with CONFLICT, not FORBIDDEN", () => {
    // FORBIDDEN would read as "you lack permission" and send the reader to an
    // admin, when what they need is the restore button.
    try {
      assertNotArchived(t, new Date());
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("CONFLICT");
    }
  });

  test("the entity selects its own message", () => {
    // Asserting on behaviour, not on an English spelling: `entity` names a
    // dictionary key now, so the message it picks is a whole translated
    // sentence with no "note" in it at all.
    expect(messageFrom(() => assertNotArchived(t, new Date(), "note"))).toBe(t.archived.note);
    expect(messageFrom(() => assertNotArchived(t, new Date()))).toBe(t.archived.project);
  });
});
