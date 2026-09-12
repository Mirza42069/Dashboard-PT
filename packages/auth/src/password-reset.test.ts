import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import { verifyPassword } from "better-auth/crypto";

describe.skipIf(!process.env.DATABASE_URL)("self-service password reset", () => {
  let auth: typeof import("./index");
  let restores: (() => void)[] = [];
  type Query = { sql: string; params: unknown[] };
  let batches: Query[][];
  let respond: (query: Query) => unknown;
  let batchRespond: (queries: Query[]) => unknown[];
  beforeAll(async () => { auth = await import("./index"); });
  afterEach(() => { restores.forEach((restore) => restore()); restores = []; });

  function intercept() {
    batches = [];
    respond = () => [];
    batchRespond = () => [[{ id: "ver-1" }], [{ id: "target" }], [], []];
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
      const built = items.map((item) => (item as unknown as { toSQL(): Query }).toSQL());
      batches.push(built);
      return batchRespond(built) as never;
    });
    const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => respond(query as Query),
    }) as never);
    restores.push(() => batch.mockRestore(), () => prepare.mockRestore());
  }

  async function sha256Hex(value: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Buffer.from(digest).toString("hex");
  }

  test("guard rails reject before any query", async () => {
    intercept();
    expect(await auth.consumePasswordResetToken("token", "short")).toBe(false);
    expect(await auth.consumePasswordResetToken("", "New password 123!")).toBe(false);
    expect(batches).toHaveLength(0);
  });

  test("unknown account answers null with no write", async () => {
    intercept();
    respond = () => [];
    expect(await auth.createPasswordResetToken("nobody@example.com")).toBeNull();
    expect(batches).toHaveLength(0);
  });

  test("request stores only the token hash, namespaced to the account", async () => {
    intercept();
    respond = () => [{ id: "target" }];
    const token = await auth.createPasswordResetToken("owner@example.com");
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const [replace, insert] = batches[0]!;
    expect(replace!.sql).toContain('delete from "verification"');
    expect(insert!.sql).toContain('insert into "verification"');
    expect(insert!.params).toContain("reset-password:target");
    expect(insert!.params).not.toContain(token);
    expect(insert!.params).toContain(await sha256Hex(token!));
  });

  test("consume verifies the hash, rotates the revision, rewrites the password, kills every session", async () => {
    intercept();
    const verRow = { id: "ver-1", identifier: "reset-password:target" };
    respond = (query) => (query.sql.includes("verification") ? [verRow] : [{ revision: "rev-1" }]);
    const newPassword = "New password 123!";
    expect(await auth.consumePasswordResetToken("some-token", newPassword)).toBe(true);
    const [singleUse, userWrite, passwordWrite, sessions] = batches[0]!;
    expect(singleUse!.sql).toContain('"verification"."id" =');
    expect(userWrite!.sql).toContain('"must_change_password" =');
    expect(userWrite!.sql).toContain('"user"."password_setup_token_hash" =');
    expect(userWrite!.params).toContain(false);
    expect(userWrite!.params).toContain("rev-1");
    const hash = passwordWrite!.params.find((p) => typeof p === "string" && p.includes(":")) as string;
    expect(await verifyPassword({ hash, password: newPassword })).toBe(true);
    expect(sessions!.sql).toContain('delete from "session"');
    expect(sessions!.sql).not.toContain("<>");
    // Regression: the password and session writes re-evaluate their armed-user
    // subquery AFTER the user update rotated the revision. If they still match
    // on the OLD revision they silently match 0 rows — token consumed, password
    // unchanged, user locked out.
    expect(passwordWrite!.sql).toContain('"user"."password_setup_token_hash" =');
    expect(passwordWrite!.params).not.toContain("rev-1");
    expect(sessions!.params).not.toContain("rev-1");
  });

  test("unknown, expired and already-consumed tokens all refuse without effect", async () => {
    intercept();
    respond = () => [];
    expect(await auth.consumePasswordResetToken("bogus", "New password 123!")).toBe(false);
    const verRow = { id: "ver-1", identifier: "reset-password:target" };
    respond = (query) => (query.sql.includes("verification") ? [verRow] : [{ revision: "rev-1" }]);
    batchRespond = () => [[], [], [], []];
    expect(await auth.consumePasswordResetToken("spent-token", "New password 123!")).toBe(false);
  });
});
