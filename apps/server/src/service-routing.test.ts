import { describe, expect, test } from "bun:test";

describe.skipIf(!process.env.DATABASE_URL)("service prefix routing", () => {
  test("original and transformed service URLs reach the same health route", async () => {
    const { default: app } = await import("./index");
    for (const path of ["/", "/api/"]) {
      const response = await app.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("OK");
    }
  });

  test("tRPC receives a normalized URL and keeps the authentication boundary", async () => {
    const { default: app } = await import("./index");
    for (const path of ["/trpc/project.summary", "/api/trpc/project.summary"]) {
      const response = await app.request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { data: { code: "UNAUTHORIZED" } } });
    }
  });

  test("Better Auth retains its own API prefix", async () => {
    const { default: app } = await import("./index");
    const response = await app.request("/api/auth/get-session");
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
});
