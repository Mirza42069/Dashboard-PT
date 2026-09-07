import { describe, expect, test } from "bun:test";

import type { Context } from "./context";
import { dictionaryFor } from "./lib/messages";
import { authenticatedProcedure, companyProcedure, protectedProcedure, router } from "./index";

const testRouter = router({
  regular: protectedProcedure.query(() => "regular"),
  ownPassword: authenticatedProcedure.mutation(({ ctx }) => ctx.session.user.id),
  tenant: companyProcedure.query(() => "tenant"),
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

    await expect(caller.regular()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.tenant()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.ownPassword()).resolves.toBe("user-1");
  });

  test("allows ordinary procedures after password setup", async () => {
    await expect(testRouter.createCaller(context(false)).regular()).resolves.toBe("regular");
  });
});
