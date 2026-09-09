import { expect, test } from "bun:test";
// Installed Next still exports the matcher utility under its middleware name.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

import proxy, { config } from "./proxy";

test.each(["/", "/login", "/set-password"])("public page renders with absent or stale session: %s", (path) => {
  for (const cookie of ["", "better-auth.session_token=stale"]) {
    const response = proxy(new NextRequest(`https://app.example.com${path}`, {
      headers: { cookie },
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("location")).toBeNull();
  }
});

test.each(["/dashboard?tab=active&search=a%20b", "/admin/users", "/login-private", "/unknown"])("protected page preserves its full next destination: %s", (path) => {
  const response = proxy(new NextRequest(`https://app.example.com${path}`));
  expect(response.status).toBe(307);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe("https://app.example.com");
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("next")).toBe(path);
});

test("session cookie passes the optimistic dashboard gate", () => {
  const response = proxy(new NextRequest("https://app.example.com/dashboard", {
    headers: { cookie: "better-auth.session_token=present" },
  }));
  expect(response.headers.get("x-middleware-next")).toBe("1");
});

test.each(["/", "/login"])("public locale handoff sets cookie and removes only locale: %s", (path) => {
  for (const locale of ["en", "id"]) {
    const url = new URL(path, "https://app.example.com");
    url.searchParams.set("locale", locale);
    url.searchParams.set("next", "/dashboard?tab=active&search=a b");
    url.searchParams.append("campaign", "one");
    url.searchParams.append("campaign", "two");
    const response = proxy(new NextRequest(url));
    expect(response.status).toBe(307);
    url.searchParams.delete("locale");
    expect(response.headers.get("location")).toBe(url.href);
    expect(response.cookies.get("v2.locale")).toMatchObject({
      value: locale, path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax",
    });
    const followup = proxy(new NextRequest(url, {
      headers: { cookie: `v2.locale=${locale}` },
    }));
    expect(followup.headers.get("x-middleware-next")).toBe("1");
  }
});

test.each(["/", "/login"])("invalid locale is ignored on public page: %s", (path) => {
  for (const locale of ["", "fr", "EN"]) {
    const response = proxy(new NextRequest(`https://app.example.com${path}?locale=${locale}&next=%2Fdashboard`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  }
});

test("protected locale query stays in next rather than setting a cookie", () => {
  const path = "/dashboard?locale=en&tab=active";
  const response = proxy(new NextRequest(`https://app.example.com${path}`));
  expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe(path);
  expect(response.headers.get("set-cookie")).toBeNull();
});

test.each(["/set-password", "/login/nested"])("other public routes do not consume locale: %s", (path) => {
  const response = proxy(new NextRequest(`https://app.example.com${path}?locale=en`));
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(response.headers.get("set-cookie")).toBeNull();
});

test.each([
  "/_vercel/insights/script.js",
  "/_vercel/speed-insights/script.js",
  "/_vercel/insights/view",
  "/_vercel/speed-insights/vitals",
])("telemetry bypasses the auth proxy: %s", (url) => {
  expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(false);
});

test.each([
  "/dashboard",
  "/admin",
  "/admin/users",
  "/_vercel-private",
  "/_vercel-private/insights/script.js",
])("protected routes still match the auth proxy: %s", (url) => {
  expect(unstable_doesProxyMatch({ config, nextConfig: {}, url })).toBe(true);
});
