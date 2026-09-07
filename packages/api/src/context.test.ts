import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context as HonoContext } from "hono";

import type { Context } from "./context";
import { companyPermissionProcedure, publicProcedure, router } from "./index";
import { dictionaryFor } from "./lib/messages";

// Only configuration is needed; all database execution and auth are intercepted.
describe.skipIf(!process.env.DATABASE_URL)("request context", () => {
  let createContext: typeof import("./context").createContext;
  let createContextFromSession: typeof import("./context").createContextFromSession;
  let auth: typeof import("@DashboardV2/auth").auth;
  const restores: (() => void)[] = [];

  beforeAll(async () => {
    ({ createContext, createContextFromSession } = await import("./context"));
    ({ auth } = await import("@DashboardV2/auth"));
  });
  afterEach(() => { restores.splice(0).forEach((restore) => restore()); });

  function session(role = "super_admin", companyId: string | null = null) {
    return {
      user: { id: "user-1", role, companyId, mustChangePassword: false },
      session: { id: "session-1", userId: "user-1" },
    } as NonNullable<Context["session"]>;
  }

  function intercept(execute: (params: unknown[]) => Promise<unknown[]>) {
    const queries: unknown[][] = [];
    const spy = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => {
        queries.push(query.params);
        return execute(query.params);
      },
    }) as never);
    restores.push(() => spy.mockRestore());
    return queries;
  }

  test("tenant lookup stays lazy and concurrent calls share one promise", async () => {
    const queries = intercept(async () => [{ id: "company-2" }]);
    const ctx = createContextFromSession({
      headers: new Headers({ cookie: "v2.company=company-2" }), session: session(),
    });
    const publicRouter = router({ health: publicProcedure.query(() => "OK") });
    expect(await publicRouter.createCaller(ctx).health()).toBe("OK");
    expect(queries).toHaveLength(0);
    const first = ctx.getCompanyId();
    expect(ctx.getCompanyId()).toBe(first);
    expect(await first).toBe("company-2");
    expect(ctx.getCompanyId()).toBe(first);
    expect(queries).toEqual([["company-2"]]);
  });

  test("tenant rejection is cached, but never shared with another context", async () => {
    const queries = intercept(async () => { throw new Error("database unavailable"); });
    const options = { headers: new Headers({ cookie: "v2.company=company-2" }), session: session() };
    const ctx = createContextFromSession(options);
    const first = ctx.getCompanyId();
    const failure = await first.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(ctx.getCompanyId()).toBe(first);
    expect(await ctx.getCompanyId().catch((error: unknown) => error)).toBe(failure);
    expect(queries).toHaveLength(1);
    const second = createContextFromSession(options).getCompanyId();
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
    expect(queries).toHaveLength(2);
  });

  test("headers and session are preserved and locale comes from the request cookie", () => {
    const resolved = session();
    for (const [cookie, locale] of [["v2.locale=en", "en"], ["v2.locale=id", "id"], ["v2.locale=invalid", "id"], ["", "id"]] as const) {
      const headers = new Headers({ cookie, authorization: "Bearer test", origin: "https://dashboard.test" });
      const ctx = createContextFromSession({ headers, session: resolved });
      expect(ctx.headers).toBe(headers);
      expect(ctx.headers.get("authorization")).toBe("Bearer test");
      expect(ctx.headers.get("origin")).toBe("https://dashboard.test");
      expect(ctx.session).toBe(resolved);
      expect(ctx.locale).toBe(locale);
      expect(ctx.t).toBe(dictionaryFor(locale));
    }
  });

  test("missing session fails with localized UNAUTHORIZED without a tenant query", () => {
    const queries = intercept(async () => []);
    const ctx = createContextFromSession({ headers: new Headers({ cookie: "v2.locale=en" }), session: null });
    expect(() => ctx.getCompanyId()).toThrow(expect.objectContaining({
      code: "UNAUTHORIZED", message: dictionaryFor("en").auth.required,
    }));
    expect(queries).toHaveLength(0);
  });

  test("direct callers retain permission gates and ignore tenant cookies for pinned users", async () => {
    const queries = intercept(async () => { throw new Error("Unexpected tenant lookup"); });
    const tenantRouter = router({
      tenant: companyPermissionProcedure("company:manage").query(({ ctx }) => ctx.companyId),
    });
    const headers = new Headers({ cookie: "v2.company=other-company" });
    const ctx = createContextFromSession({ headers, session: session("user", "own-company") });
    expect(await ctx.getCompanyId()).toBe("own-company");
    await expect(tenantRouter.createCaller(ctx).tenant()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = createContextFromSession({ headers, session: session("admin", "second-company") });
    expect(await other.getCompanyId()).toBe("second-company");
    expect(queries).toHaveLength(0);
  });

  test("super-admin cookie is validated before middleware receives the tenant", async () => {
    const queries = intercept(async (params) => params[0] === "forged-company" ? [] : [{ id: "valid-company" }]);
    const tenantRouter = router({
      tenant: companyPermissionProcedure("company:manage").query(({ ctx }) => ctx.companyId),
    });
    const ctx = createContextFromSession({
      headers: new Headers({ cookie: "v2.company=forged-company" }), session: session(),
    });
    expect(await tenantRouter.createCaller(ctx).tenant()).toBe("valid-company");
    expect(queries).toHaveLength(2);
    expect(queries[0]).toEqual(["forged-company"]);
  });

  test("Hono adapter authenticates once using the original headers", async () => {
    const queries = intercept(async () => { throw new Error("Unexpected tenant lookup"); });
    const resolved = session();
    const getSession = spyOn(auth.api, "getSession").mockResolvedValue(resolved);
    restores.push(() => getSession.mockRestore());
    const headers = new Headers({ cookie: "v2.locale=en; v2.company=company-2", authorization: "Bearer test" });
    const context = { req: { raw: { headers } } } as HonoContext;
    const ctx = await createContext({ context });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(getSession.mock.calls[0]?.[0]?.headers).toBe(headers);
    expect(ctx.headers).toBe(headers);
    expect(ctx.session).toBe(resolved);
    expect(ctx.locale).toBe("en");
    createContextFromSession({ headers, session: resolved });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(0);
  });

  test("Hono adapter preserves null sessions and propagates authentication errors", async () => {
    const getSession = spyOn(auth.api, "getSession").mockResolvedValue(null);
    restores.push(() => getSession.mockRestore());
    const context = { req: { raw: { headers: new Headers() } } } as HonoContext;
    expect((await createContext({ context })).session).toBeNull();
    const failure = new Error("auth unavailable");
    getSession.mockRejectedValue(failure);
    await expect(createContext({ context })).rejects.toBe(failure);
  });
});
