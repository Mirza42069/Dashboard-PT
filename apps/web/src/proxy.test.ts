import { expect, test } from "bun:test";
// Installed Next still exports the matcher utility under its middleware name.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";

import { config } from "./proxy";

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
