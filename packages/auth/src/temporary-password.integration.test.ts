import { SQL } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpPreparedQuery, NeonHttpSession } from "drizzle-orm/neon-http";
import { verifyPassword } from "better-auth/crypto";

// Opt-in, disposable LOCAL database only. Never use the application's database.
const testUrl = process.env.PASSWORD_SETUP_TEST_DATABASE_URL;
describe.skipIf(!testUrl)("temporary password PostgreSQL transactions", () => {
  let database: SQL;
  let auth: typeof import("./index");
  let restores: (() => void)[] = [];
  type Prepared = { getQuery(): { sql: string; params: unknown[] }; isResponseInArrayMode(): boolean; mapResult(result: unknown): unknown };
  let beforeBatch: (query: ReturnType<Prepared["getQuery"]>) => Promise<void>;
  const target = { role: "user", companyId: "company-1", pendingOnly: false };

  async function execute(prepared: Prepared, connection: Pick<SQL, "unsafe">) {
    const query = prepared.getQuery();
    if (prepared.isResponseInArrayMode()) {
      const rows = await connection.unsafe(query.sql, query.params as never[]).values();
      return prepared.mapResult({ rows: rows.map((row: unknown[]) => row.map((value) => value instanceof Date ? value.toISOString().replace("Z", "") : value)) });
    }
    return prepared.mapResult({ rows: await connection.unsafe(query.sql, query.params as never[]) });
  }
  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/auth_setup_test") throw new Error("Requires disposable localhost auth_setup_test database");
    database = new SQL(testUrl!, { max: 8, prepare: false });
    await database.unsafe(`
      CREATE TABLE "user" (id text PRIMARY KEY, role text NOT NULL, company_id text,
        must_change_password boolean NOT NULL DEFAULT true, password_setup_token_hash text,
        banned boolean NOT NULL DEFAULT false, trial_ends_at timestamp,
        updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE account (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id),
        provider_id text NOT NULL, password text, updated_at timestamp NOT NULL DEFAULT now());
      CREATE TABLE session (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id), expires_at timestamp NOT NULL DEFAULT now() + interval '1 day',
        token text, created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(), ip_address text, user_agent text, impersonated_by text);
      CREATE TABLE verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
        expires_at timestamp NOT NULL, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now());
    `);
    auth = await import("./index");
  });
  afterAll(async () => {
    if (!database) return;
    await database.unsafe('DROP TABLE IF EXISTS verification, session, account, "user" CASCADE');
    await database.close();
  });
  beforeEach(async () => {
    beforeBatch = async () => {};
    await database.unsafe(`INSERT INTO "user" (id, role, company_id) VALUES ('target', 'user', 'company-1');
      INSERT INTO account (id, user_id, provider_id, password) VALUES ('credential', 'target', 'credential', 'original');`);
    const prepared = spyOn(NeonHttpPreparedQuery.prototype, "execute").mockImplementation(async function (this: Prepared) { return execute(this, database); });
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
      const prepared = items.map((item) => (item as unknown as { _prepare(): Prepared })._prepare());
      await beforeBatch(prepared[0]!.getQuery());
      return database.begin(async (tx) => {
        const results: unknown[] = [];
        for (const item of prepared) results.push(await execute(item, tx));
        return results;
      });
    });
    restores.push(() => prepared.mockRestore(), () => batch.mockRestore());
  });
  afterEach(async () => {
    restores.splice(0).forEach((fn) => fn());
    await database.unsafe('TRUNCATE verification, session, account, "user" CASCADE');
  });
  async function signIn() { await database.unsafe("INSERT INTO session (id, user_id) VALUES ('current', 'target') ON CONFLICT DO NOTHING"); }
  async function passwordIs(password: string) {
    const [row] = await database.unsafe("SELECT password FROM account WHERE id = 'credential'");
    return verifyPassword({ password, hash: row.password });
  }

  test("reset revokes every session; owner change unlocks and retains only current session", async () => {
    await signIn();
    const temporary = await auth.resetTemporaryPassword("target", target);
    expect(await database.unsafe("SELECT * FROM session")).toHaveLength(0);
    expect(await passwordIs(temporary)).toBe(true);
    await signIn();
    await database.unsafe("INSERT INTO session (id, user_id) VALUES ('other', 'target')");
    expect(await auth.changeOwnPassword("target", "current", temporary, "Owner password 123!")).toBe(true);
    expect(await passwordIs("Owner password 123!")).toBe(true);
    expect(await database.unsafe("SELECT id FROM session")).toEqual([{ id: "current" }]);
    expect((await database.unsafe('SELECT * FROM "user"'))[0].must_change_password).toBe(false);
  });

  test("stale verified change cannot overwrite a newer admin reset", async () => {
    const temporary = await auth.resetTemporaryPassword("target", target);
    await signIn();
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    beforeBatch = async (query) => { if (query.params.includes(false)) { reached.resolve(); await release.promise; } };
    const stale = auth.changeOwnPassword("target", "current", temporary, "Stale password 123!");
    await reached.promise;
    let fresh = "";
    try { fresh = await auth.resetTemporaryPassword("target", target); } finally { release.resolve(); }
    expect(await stale).toBe(false);
    expect(await passwordIs(fresh)).toBe(true);
    expect((await database.unsafe('SELECT * FROM "user"'))[0].must_change_password).toBe(true);
  });

  test("simultaneous owner changes have exactly one winner", async () => {
    const temporary = await auth.resetTemporaryPassword("target", target);
    await signIn();
    const ready = Promise.withResolvers<void>();
    let waiting = 0;
    beforeBatch = async () => { if (++waiting === 2) ready.resolve(); await ready.promise; };
    const results = await Promise.all([
      auth.changeOwnPassword("target", "current", temporary, "First password 123!"),
      auth.changeOwnPassword("target", "current", temporary, "Second password 123!"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await passwordIs(results[0] ? "First password 123!" : "Second password 123!")).toBe(true);
  });

  test("established System cannot be reset even with a stale pending snapshot", async () => {
    await database.unsafe(`UPDATE "user" SET role = 'super_admin', company_id = NULL`);
    const system = { role: "super_admin", companyId: null, pendingOnly: false };
    const temporary = await auth.resetTemporaryPassword("target", system);
    await signIn();
    expect(await auth.changeOwnPassword("target", "current", temporary, "System password 123!")).toBe(true);
    let error: unknown;
    try { await auth.resetTemporaryPassword("target", system); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(await passwordIs("System password 123!")).toBe(true);
  });

  test("failed password write rolls back unlock and session revocation", async () => {
    const temporary = await auth.resetTemporaryPassword("target", target);
    await signIn();
    await database.unsafe(`CREATE FUNCTION reject_test_password() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test password failure'; END $$;
      CREATE TRIGGER reject_test_password BEFORE UPDATE ON account FOR EACH ROW EXECUTE FUNCTION reject_test_password();`);
    let error: unknown;
    try { await auth.changeOwnPassword("target", "current", temporary, "Owner password 123!"); } catch (caught) { error = caught; }
    finally { await database.unsafe("DROP TRIGGER reject_test_password ON account; DROP FUNCTION reject_test_password()"); }
    expect(error).toBeInstanceOf(Error);
    expect(await passwordIs(temporary)).toBe(true);
    expect((await database.unsafe('SELECT * FROM "user"'))[0].must_change_password).toBe(true);
    expect(await database.unsafe("SELECT * FROM session")).toHaveLength(1);
  });

  test("session insertion paused before its lock rejects a credential replaced by an owner change", async () => {
    const temporary = await auth.resetTemporaryPassword("target", target);
    await signIn();
    const [snapshot] = await database.unsafe('SELECT password_setup_token_hash FROM "user"');
    const context = await auth.auth.$context;
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    beforeBatch = async (query) => {
      if (query.sql.toLowerCase().includes("for update")) { reached.resolve(); await release.promise; }
    };
    const pending = context.adapter.create({ model: "session", data: {
      userId: "target", token: "stale-session-token", credentialRevision: snapshot.password_setup_token_hash,
      expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), updatedAt: new Date(),
    } }).then(() => null, (error: unknown) => error);
    await reached.promise;
    try { expect(await auth.changeOwnPassword("target", "current", temporary, "Owner password 123!")).toBe(true); }
    finally { release.resolve(); }
    expect(await pending).toMatchObject({ status: "UNAUTHORIZED" });
    expect(await database.unsafe("SELECT id FROM session")).toEqual([{ id: "current" }]);
  });

  test("a session inserted first is removed by the subsequent reset", async () => {
    await auth.resetTemporaryPassword("target", target);
    const [snapshot] = await database.unsafe('SELECT password_setup_token_hash FROM "user"');
    const context = await auth.auth.$context;
    await context.adapter.create({ model: "session", data: {
      userId: "target", token: "old-session-token", credentialRevision: snapshot.password_setup_token_hash,
      expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), updatedAt: new Date(),
    } });
    expect(await database.unsafe("SELECT id FROM session")).toHaveLength(1);
    await auth.resetTemporaryPassword("target", target);
    expect(await database.unsafe("SELECT id FROM session")).toHaveLength(0);
  });
});
