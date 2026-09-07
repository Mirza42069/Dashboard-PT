import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";

describe.skipIf(!process.env.DATABASE_URL)("pending-session HTTP access", () => {
  let app: typeof import("./index").default;
  let auth: typeof import("@DashboardV2/auth").auth;
  const restores: (() => void)[] = [];
  beforeAll(async () => {
    ({ default: app } = await import("./index"));
    ({ auth } = await import("@DashboardV2/auth"));
  });
  afterEach(() => restores.splice(0).forEach((fn) => fn()));
  test("pending users get session/logout only on raw auth and cannot access tenant APIs", async () => {
    const session = spyOn(auth.api, "getSession").mockResolvedValue({
      user: { id: "pending", role: "super_admin", mustChangePassword: true },
      session: { id: "pending-session" },
    } as never);
    const handler = spyOn(auth, "handler").mockImplementation(async () => Response.json({ success: true }));
    restores.push(() => session.mockRestore(), () => handler.mockRestore());
    for (const path of ["get-session", "sign-out"]) {
      expect((await app.request(`/api/auth/${path}`, { method: path === "sign-out" ? "POST" : "GET" })).status).toBe(200);
    }
    for (const path of ["update-user", "change-password", "reset-password", "reset-password/old-token", "admin/set-user-password", "admin/list-users"]) {
      expect((await app.request(`/api/auth/${path}`, { method: "POST" })).status).toBe(404);
    }
    expect((await app.request("/api/auth/list-sessions")).status).toBe(403);
    expect((await app.request("/notes/target/photos", { method: "POST" })).status).toBe(401);
    const trpc = await app.request("/trpc/admin.listUsers?input=%7B%7D");
    expect(trpc.status).toBe(403);
    expect(trpc.headers.get("cache-control")).toContain("no-store");
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
