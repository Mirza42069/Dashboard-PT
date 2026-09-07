import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context } from "../context";
import { dictionaryFor } from "../lib/messages";

describe.skipIf(!process.env.DATABASE_URL)("admin account setup authorization", () => {
  let adminRouter: typeof import("./admin").adminRouter;
  let auth: typeof import("@DashboardV2/auth").auth;
  let restores: (() => void)[] = [];
  let queries: { sql: string; params: unknown[] }[];
  let target: { role: string; companyId: string | null; name: string; email: string; mustChangePassword: boolean } | null;
  let batchCount: number;
  let batches: { sql: string; params: unknown[] }[][];
  const ctx = (role = "admin") => ({
    headers: new Headers(), locale: "en", t: dictionaryFor("en"),
    session: { user: { id: "actor", name: "Admin", role, mustChangePassword: false } },
    getCompanyId: async () => "company-1",
  }) as unknown as Context;

  beforeAll(async () => {
    ({ adminRouter } = await import("./admin"));
    ({ auth } = await import("@DashboardV2/auth"));
  });
  afterEach(() => { restores.forEach((fn) => fn()); restores = []; });

  function intercept() {
    queries = [];
    batchCount = 0;
    batches = [];
    target = { role: "user", companyId: "company-1", name: "Target", email: "target@example.com", mustChangePassword: false };
    const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => {
        queries.push(query);
        if (query.sql.startsWith("select") && query.sql.includes('from "company"')) return [{ id: "company-2" }];
        if (query.sql.startsWith("select") && query.sql.includes('from "user"')) {
          if (query.sql.includes('"username"')) return [];
          return target ? [target] : [];
        }
        return [];
      },
    }) as never);
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
      batchCount++;
      batches.push(items.map((item) => (item as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL()));
      return [[{ id: "target" }], [], [], [], []] as never;
    });
    const setPassword = spyOn(auth.api, "setUserPassword").mockResolvedValue({ status: true } as never);
    const revoke = spyOn(auth.api, "revokeUserSessions").mockResolvedValue({ success: true } as never);
    const create = spyOn(auth.api, "createUser").mockResolvedValue({ user: { id: "target", name: "Target", email: "target@example.com" } } as never);
    restores.push(() => prepare.mockRestore(), () => batch.mockRestore(), () => setPassword.mockRestore(), () => revoke.mockRestore(), () => create.mockRestore());
    return { setPassword, revoke, create, batch };
  }

  test("unauthenticated, ordinary, and password-locked callers cannot create or reset", async () => {
    intercept();
    for (const context of [
      { ...ctx(), session: null },
      ctx("user"),
      { ...ctx(), session: { user: { ...ctx().session!.user, mustChangePassword: true } } },
    ]) {
      const caller = adminRouter.createCaller(context as Context);
      await expect(caller.createUser({ name: "Target", email: "target@example.com" })).rejects.toBeDefined();
      await expect(caller.resetPassword({ userId: "target" })).rejects.toBeDefined();
    }
    expect(queries).toHaveLength(0);
    expect(batchCount).toBe(0);
  });

  test("company admins cannot reset themselves, peer admins, foreign users or missing accounts", async () => {
    const { setPassword, revoke } = intercept();
    const caller = adminRouter.createCaller(ctx());
    await expect(caller.resetPassword({ userId: "actor" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    target!.role = "admin";
    await expect(caller.resetPassword({ userId: "target" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    target!.role = "user";
    target!.companyId = "company-2";
    await expect(caller.resetPassword({ userId: "target" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    target = null;
    await expect(caller.resetPassword({ userId: "target" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(setPassword).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(batchCount).toBe(0);
  });

  test("System-account reset remains prohibited even for a System actor", async () => {
    const { setPassword } = intercept();
    target!.role = "super_admin";
    await expect(adminRouter.createCaller(ctx("super_admin")).resetPassword({ userId: "target" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(setPassword).not.toHaveBeenCalled();
    expect(batchCount).toBe(0);
  });

  test("company admins cannot create privileged or cross-company accounts", async () => {
    const { create } = intercept();
    const caller = adminRouter.createCaller(ctx());
    await expect(caller.createUser({ name: "Target", email: "target@example.com", role: "admin" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.createUser({ name: "Target", email: "target@example.com", companyId: "company-2" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
    expect(batchCount).toBe(0);
  });

   test("creation returns a temporary password once without auditing it and preserves the username", async () => {
    const { create } = intercept();
    const result = await adminRouter.createCaller(ctx()).createUser({ name: "Target", email: "target@example.com" });
    expect(result.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/);
    expect(batchCount).toBe(0);
    const password = create.mock.calls[0]![0]!.body.password!;
    expect(password).toBe(result.temporaryPassword);
    expect(create.mock.calls[0]![0]!.body.data).toMatchObject({ username: "target", displayUsername: "Target" });
    expect(queries.some((q) => q.sql.startsWith('update "user"') && q.params.includes("company-1"))).toBe(true);
    expect(queries.every((q) => !JSON.stringify(q).includes(password))).toBe(true);
  });

  test("reset locks credentials and revokes sessions inside issuance, never through an unguarded writer", async () => {
    const { setPassword, revoke } = intercept();
    const result = await adminRouter.createCaller(ctx()).resetPassword({ userId: "target" });
    expect(Object.keys(result)).toEqual(["temporaryPassword"]);
    expect(result.temporaryPassword).toHaveLength(16);
    expect(JSON.stringify(batches)).not.toContain(result.temporaryPassword);
    expect(setPassword).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    expect(batches[0]![0]!.params).toContain("company-1");
    expect(batches[0]![0]!.params).toContain("user");
    expect(batches[0]![1]!.sql).toContain('update "account"');
    expect(batches[0]![2]!.sql).toContain('delete from "session"');
  });

  test("failed reset exposes no driver details and does not delete an account", async () => {
    const { batch } = intercept();
    batch.mockRejectedValue(new Error("sensitive SQL parameters"));
    await expect(adminRouter.createCaller(ctx()).resetPassword({ userId: "target" })).rejects.toMatchObject({ message: dictionaryFor("en").user.passwordResetFailed });
    expect(queries.some((q) => q.sql.startsWith('delete from "user"'))).toBe(false);
  });

  test("only a System actor can reissue for a pending System, with pending checked again in SQL", async () => {
    intercept();
    target!.role = "super_admin";
    target!.companyId = null;
    target!.mustChangePassword = true;
    await expect(adminRouter.createCaller(ctx()).resetPassword({ userId: "target", pendingOnly: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await adminRouter.createCaller(ctx("super_admin")).resetPassword({ userId: "target", pendingOnly: true });
    expect(result.temporaryPassword).toHaveLength(16);
    expect(batches[0]![0]!.sql).toContain('"user"."must_change_password" =');
    expect(batches[0]![0]!.params).toContain("super_admin");
    target!.mustChangePassword = false;
    await expect(adminRouter.createCaller(ctx("super_admin")).resetPassword({ userId: "target", pendingOnly: true }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  for (const transition of ["company", "role"] as const) {
    test(`${transition} changes atomically advance credential revision and revoke old tokens/sessions`, async () => {
      intercept();
      const caller = adminRouter.createCaller(ctx("super_admin"));
      if (transition === "company") await caller.setCompany({ userId: "target", companyId: "company-2" });
      else await caller.setRole({ userId: "target", role: "super_admin" });
      const [binding, tokens, sessions] = batches[0]!;
      expect(binding!.sql).toContain('update "user"');
      expect(binding!.sql).toContain('"password_setup_token_hash" =');
       expect(binding!.params.some((value) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value))).toBe(true);
       const invalidation = batches[0]![3]!;
       expect(invalidation.sql).toContain('update "account"');
       expect(invalidation.sql).toContain('"user"."must_change_password" =');
       expect(invalidation.params).toContain(true);
       expect(invalidation.params).toContain("credential");
       expect(invalidation.params.some((value) => typeof value === "string" && /^[a-f0-9]+:[a-f0-9]+$/.test(value))).toBe(true);
      expect(binding!.params).toContain(transition === "company" ? "company-2" : "super_admin");
      expect(tokens!.sql).toContain('delete from "verification"');
      expect(tokens!.params).toEqual(["target", "reset-password:%"]);
      expect(sessions!.sql).toContain('delete from "session"');
      // Pending state is preserved, allowing the newly authorized admin to reissue.
      expect(binding!.sql).not.toContain('"must_change_password" =');
    });
  }

  test("a target that changes after authorization cannot receive a password from the stale mutation", async () => {
    const { batch, setPassword } = intercept();
    batch.mockResolvedValue([[], [], [], [], []] as never);
    await expect(adminRouter.createCaller(ctx()).resetPassword({ userId: "target" }))
      .rejects.toMatchObject({ message: dictionaryFor("en").user.passwordResetFailed });
    expect(setPassword).not.toHaveBeenCalled();
  });
});
