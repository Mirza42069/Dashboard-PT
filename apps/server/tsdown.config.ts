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
  /**
   * Everything is inlined, not just @DashboardV2/*.
   *
   * Vercel runs src/index.ts under Bun rather than bundling it, so every bare
   * specifier is resolved at cold start relative to the file that imports it —
   * and `packages/env/src/server.ts` asking for `@t3-oss/env-core` looks in
   * packages/env/node_modules, which is not part of the deployed function.
   * Declaring the dependency on apps/server cannot help: Bun never looks there.
   * Leaving nothing external is what removes the failure rather than moving it.
   */
  deps: { alwaysBundle: [/.*/] },
  /**
   * exceljs stays out. It is CommonJS over a tree of dynamic requires that does
   * not survive bundling, and it is reachable only from the export route, which
   * loads it on demand. External and lazy, the worst it can cost is the
   * spreadsheet download; bundled, it would be back in the boot path.
   */
  external: ["exceljs"],
  /** One file, so there are no sibling chunks left to resolve or to package. */
  outputOptions: { inlineDynamicImports: true },
});
