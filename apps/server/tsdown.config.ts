import { defineConfig } from "tsdown";

/**
 * A self-contained bundle for `bun run start`. **Not** what Vercel deploys —
 * vercel.json points the service at src/index.ts.
 *
 * It cannot be the deployed entrypoint: a service's `entrypoint` is checked
 * against the cloned source tree before installCommand or buildCommand run, and
 * dist/ is gitignored, so the deploy fails validation with "entrypoint
 * dist/index.mjs ... does not exist" before anything has a chance to build it.
 *
 * The cold-start resolve failure this was originally reaching for is real, but
 * it belongs to package.json, not to a bundler. Bun installs a workspace
 * package's deps into *its* node_modules rather than hoisting them, so
 * @t3-oss/env-core (packages/env) and @neondatabase/serverless (packages/db)
 * sat outside apps/server entirely and were never traced into the function —
 * the process died with a ResolveMessage before serving anything and every
 * /api route 500d, sign-in included. Both are now direct dependencies of
 * apps/server, so they resolve from apps/server/node_modules like everything
 * else and tracing picks them up. Anything a workspace package pulls in at
 * runtime has to be declared here too.
 *
 * noExternal inlines @DashboardV2/*, so the bundle runs without the workspace
 * on disk.
 */
export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@DashboardV2\/.*/],
});
