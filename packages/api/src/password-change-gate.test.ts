import { describe, expect, test } from "bun:test";

import type { Context } from "./context";
import { dictionaryFor } from "./lib/messages";
import { protectedProcedure, router } from "./index";

const testRouter = router({
  regular: protectedProcedure.query(() => "regular"),
});

function context(mustChangePassword: boolean) {
  return {
    headers: new Headers(),
    locale: "en",
    t: dictionaryFor("en"),
    session: {
      session: { id: "session-1", userId: "user-1" },
      user: {
        id: "user-1",
        email: "user@example.com",
        mustChangePassword,
      },
    },
    getCompanyId: async () => "company-1",
  } as unknown as Context;
}

describe("forced password change procedure gate", () => {
  test("blocks ordinary procedures until the password is changed", async () => {
    const caller = testRouter.createCaller(context(true));

    expect(caller.regular()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("allows ordinary procedures after password setup", async () => {
    await expect(testRouter.createCaller(context(false)).regular()).resolves.toBe("regular");
  });
});
