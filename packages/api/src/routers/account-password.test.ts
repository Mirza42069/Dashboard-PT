import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context } from "../context";
import { dictionaryFor } from "../lib/messages";

describe.skipIf(!process.env.DATABASE_URL)("restricted own-password endpoint", () => {
  let router: typeof import("./account").accountRouter;
  const restores: (() => void)[] = [];
  beforeAll(async () => { router = (await import("./account")).accountRouter; });
  afterEach(() => { restores.splice(0).forEach((fn) => fn()); });
  const context = () => ({
    headers: new Headers(), locale: "en", t: dictionaryFor("en"),
    session: { user: { id: "owner", mustChangePassword: true }, session: { id: "own-session" } },
    getCompanyId: () => { throw new Error("Must not resolve tenant scope"); },
  }) as unknown as Context;

  test("pending owner may change own password, never a supplied target", async () => {
    const { auth } = await import("@DashboardV2/auth");
    const hash = await (await auth.$context).password.hash("Temporary password 123!");
    const queries: { sql: string; params: unknown[] }[] = [];
    const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => { queries.push(query); return [{ password: hash, revision: null }]; },
    }) as never);
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
      queries.push(...items.map((item) => (item as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL()));
      return [[{ id: "owner" }], [], [], []] as never;
    });
    restores.push(() => prepare.mockRestore(), () => batch.mockRestore());
    const input = { currentPassword: "Temporary password 123!", newPassword: "New owner password 123!", userId: "victim" };
    expect(await router.createCaller(context()).changePassword(input)).toEqual({ success: true });
    expect(JSON.stringify(queries)).not.toContain("victim");
    expect(queries[1]!.params).toContain("own-session");
    expect(queries[1]!.params).toContain("owner");
    await expect(router.createCaller({ ...context(), session: null }).changePassword(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
