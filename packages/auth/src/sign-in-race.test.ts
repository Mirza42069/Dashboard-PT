import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import { hashPassword } from "better-auth/crypto";

// Exercise Better Auth's real email/username endpoint and async verifier. Only
// database I/O is intercepted; the adapter's revision-bound SQL is inspected.
describe.skipIf(!process.env.DATABASE_URL)("Better Auth sign-in credential races", () => {
  let module: typeof import("./index");
  const restores: (() => void)[] = [];
  beforeAll(async () => { module = await import("./index"); });
  afterEach(() => restores.splice(0).forEach((restore) => restore()));

  for (const method of ["email", "username"] as const) {
    for (const transition of ["reset", "owner-change", "none"] as const) {
      test(`${method}: revision-bound session issuance across ${transition}`, async () => {
        const auth = module.createAuth();
        const context = await auth.$context;
        let revision = "initial-revision";
        const original = "Temporary password 123!";
        let password = await hashPassword(original);
        const user = { id: "target", email: "target@example.com", name: "Target", username: "target", displayUsername: "Target", emailVerified: false,
          role: "user", banned: false, mustChangePassword: true, companyId: "company-1", trialEndsAt: null, createdAt: new Date(), updatedAt: new Date() };
        const account = () => ({ id: "credential", accountId: "target", userId: "target", providerId: "credential", password, createdAt: new Date(), updatedAt: new Date() });
        const findEmail = spyOn(context.internalAdapter, "findUserByEmail").mockImplementation(async () => ({ user, accounts: [account()] }) as never);
        const findUser = spyOn(context.internalAdapter, "findUserById").mockResolvedValue(user as never);
        const findAccounts = spyOn(context.internalAdapter, "findAccounts").mockImplementation(async () => [account()] as never);
        const findOne = spyOn(context.adapter, "findOne").mockImplementation(async (input) => (input.model === "account" ? account() : user) as never);
        const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation(() => ({
          setToken() { return this; },
          execute: async () => [{ id: "target", revision, password }],
        }) as never);
        let sessionInsertions = 0;
        const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation(async (items) => {
          const queries = items.map((item) => {
            const query = item as unknown as { toSQL?: () => { sql: string; params: unknown[] }; _prepare(): { getQuery(): { sql: string; params: unknown[] } } };
            return query.toSQL ? query.toSQL() : query._prepare().getQuery();
          });
          if (queries[0]!.sql.toLowerCase().includes("for update")) {
            const insert = queries[1]!;
            expect(insert.sql).toContain('insert into "session"');
            expect(insert.sql).toContain('"user"."password_setup_token_hash" =');
            expect(insert.params).toContain("initial-revision");
            if (transition !== "none") expect(insert.params).not.toContain(revision);
            expect(insert.params).not.toContain(original);
            sessionInsertions++;
            return [[], transition === "none" ? [{ id: "new-session", userId: "target", token: "session-token", expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), updatedAt: new Date() }] : []] as never;
          }
          // Simulate the atomic reset/change transaction advancing its binding.
          revision = queries[0]!.params.find((value) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value)) as string;
          password = queries[1]!.params.find((value) => typeof value === "string" && value.includes(":")) as string;
          return [[{ id: "target" }], [], [], []] as never;
        });
        const reached = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const verify = context.password.verify;
        const verifier = spyOn(context.password, "verify").mockImplementation(async (input) => {
          const valid = await verify(input);
          reached.resolve();
          await release.promise;
          return valid;
        });
        restores.push(() => findEmail.mockRestore(), () => findUser.mockRestore(), () => findAccounts.mockRestore(), () => findOne.mockRestore(),
          () => prepare.mockRestore(), () => batch.mockRestore(), () => verifier.mockRestore());
        const request = method === "email"
          ? auth.api.signInEmail({ body: { email: user.email, password: original } })
          : auth.api.signInUsername({ body: { username: user.username, password: original } });
        const outcome = request.then(() => null, (error: unknown) => error);
        await reached.promise;
        try {
          if (transition === "reset") await module.resetTemporaryPassword("target", { role: "user", companyId: "company-1", pendingOnly: false });
          else if (transition === "owner-change") expect(await module.changeOwnPassword("target", "owner-session", original, "New owner password 123!")).toBe(true);
        } finally { release.resolve(); }
        if (transition === "none") expect(await outcome).toBeNull();
        else expect(await outcome).toMatchObject({ status: "UNAUTHORIZED" });
        expect(sessionInsertions).toBe(1);
      });
    }
  }
});
