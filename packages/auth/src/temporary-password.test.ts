import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import { hashPassword, verifyPassword } from "better-auth/crypto";

describe.skipIf(!process.env.DATABASE_URL)("temporary credential security", () => {
  let auth: typeof import("./index");
  let restores: (() => void)[] = [];
  type Query = { sql: string; params: unknown[] };
  let batches: Query[][];
  let queries: Query[];
  let respond: (query: Query) => unknown;
  let batchRespond: (queries: Query[]) => unknown[];
  const target = { role: "user", companyId: "company-1", pendingOnly: false };
  beforeAll(async () => { auth = await import("./index"); });
  afterEach(() => { restores.forEach((restore) => restore()); restores = []; });

  function intercept() {
    batches = []; queries = [];
    respond = () => [];
    batchRespond = () => [[{ id: "target" }], [], [], []];
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
      const built = items.map((item) => (item as unknown as { toSQL(): Query }).toSQL());
      batches.push(built);
      return batchRespond(built) as never;
    });
    const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => { queries.push(query); return respond(query); },
    }) as never);
    restores.push(() => batch.mockRestore(), () => prepare.mockRestore());
  }

  test("16 unambiguous cryptographic characters, compatible hash only in storage, atomic reset and revocation", async () => {
    intercept();
    const first = await auth.resetTemporaryPassword("target", target);
    const second = await auth.resetTemporaryPassword("target", target);
    expect(first).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{16}$/);
    expect(first).not.toBe(second);
    const [binding, password, sessions, tokens] = batches[0]!;
    expect(binding!.sql).toContain('"user"."role" =');
    expect(binding!.params).toContain("company-1");
    expect(binding!.params).toContain(true);
    const hash = password!.params.find((p) => typeof p === "string" && p.includes(":")) as string;
    expect(await verifyPassword({ hash, password: first })).toBe(true);
    expect(JSON.stringify(batches)).not.toContain(first);
    expect(sessions!.sql).toContain('delete from "session"');
    expect(tokens!.sql).toContain('delete from "verification"');
    for (const query of batches[0]!.slice(1)) expect(query.sql).toContain('"user"."password_setup_token_hash" =');
  });

  test("System protection and stale target rejection are enforced in the transaction", async () => {
    intercept();
    await auth.resetTemporaryPassword("target", { role: "super_admin", companyId: null, pendingOnly: false });
    expect(batches[0]![0]!.sql).toContain('"user"."must_change_password" =');
    expect(batches[0]![0]!.sql).toContain('"user"."company_id" is null');
    batchRespond = () => [[], [], [], []];
    await expect(auth.resetTemporaryPassword("target", target)).rejects.toThrow("Could not reset");
  });

  test("own change verifies current password, binds session and revision, unlocks atomically and retains only current session", async () => {
    intercept();
    const current = "Temporary password 123!";
    const password = await hashPassword(current);
    respond = () => [{ password, revision: "old-revision" }];
    expect(await auth.changeOwnPassword("target", "session-1", "wrong password", "New password 123!")).toBe(false);
    expect(batches).toHaveLength(0);
    expect(await auth.changeOwnPassword("target", "session-1", current, "New password 123!")).toBe(true);
    const [binding, write, sessions] = batches[0]!;
    expect(binding!.params).toContain(false);
    expect(binding!.params).toContain("old-revision");
    expect(binding!.params).toContain("session-1");
    expect(binding!.params).toContain(password);
    expect(binding!.sql).toContain("expires_at > now()");
    expect(sessions!.sql).toContain("<>");
    expect(sessions!.params).toContain("session-1");
    const hash = write!.params.find((p) => typeof p === "string" && p.includes(":")) as string;
    expect(await verifyPassword({ hash, password: "New password 123!" })).toBe(true);
    expect(JSON.stringify([...queries, ...batches])).not.toContain(current);
    batchRespond = () => [[], [], [], []];
    expect(await auth.changeOwnPassword("target", "session-1", current, "Another password 123!")).toBe(false);
  });

  test("invalid length and unchanged passwords never reach the database", async () => {
    intercept();
    for (const next of ["short", "x".repeat(129), "Current password 123!"]) {
      expect(await auth.changeOwnPassword("target", "session-1", "Current password 123!", next)).toBe(false);
    }
    expect(await auth.changeOwnPassword("target", "session-1", "AAAAAAAAAAAA", "\uFF21".repeat(12))).toBe(false);
    expect(queries).toHaveLength(0);
    expect(batches).toHaveLength(0);
  });

  test("driver errors never expose SQL, hashes or causes", async () => {
    intercept();
    batchRespond = (items) => { throw new Error(JSON.stringify(items)); };
    let failure: Error | undefined;
    try { await auth.resetTemporaryPassword("target", target); } catch (error) { failure = error as Error; }
    expect(failure?.message).toBe("Could not reset the password. Try again.");
    expect(failure?.cause).toBeUndefined();
    respond = (query) => { throw new Error(JSON.stringify(query)); };
    await expect(auth.changeOwnPassword("target", "session-1", "Current password 123!", "New password 123!")).rejects.toThrow("Could not change the password. Try again.");
  });

  test("generic password writers are disabled, including direct server calls", async () => {
    intercept();
    for (const path of ["/reset-password", "/request-password-reset", "/change-password", "/admin/set-user-password"]) {
      expect(auth.auth.options.disabledPaths).toContain(path);
      const response = await auth.auth.handler(new Request(new URL(`/api/auth${path}`, auth.auth.options.baseURL as string), {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }));
      expect(response.status).toBe(404);
    }
    await expect(auth.auth.api.changePassword({ body: { currentPassword: "Current password 123!", newPassword: "New password 123!" } })).rejects.toMatchObject({ status: "NOT_FOUND" });
    expect(queries).toHaveLength(0);
  });
});
