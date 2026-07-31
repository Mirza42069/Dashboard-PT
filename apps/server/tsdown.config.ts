import { defineConfig } from "tsdown";

/**
 * This bundle — not src/index.ts — is what vercel.json deploys as the server
 * entrypoint.
 *
 * Handing Vercel the raw source instead makes Bun resolve the whole import
 * graph at cold start, and that graph reaches out of apps/server: the workspace
 * packages need deps that bun installs into *their* node_modules, not the
 * server's (@t3-oss/env-core for packages/env, @neondatabase/serverless for
 * packages/db). Neither gets traced into the function, so the process dies with
 * a ResolveMessage before serving anything and every /api route 500s — which
 * surfaces as sign-in failing on the deployment while it works locally, where
 * the full workspace is on disk.
 *
 * noExternal inlines @DashboardV2/*, and rolldown inlines any dep apps/server
 * does not declare itself, so what is left external is exactly what resolves
 * from apps/server/node_modules.
 */
export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@DashboardV2\/.*/],
});
