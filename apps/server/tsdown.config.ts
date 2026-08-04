import { defineConfig } from "tsdown";

/**
 * A self-contained bundle for `bun run start` and the Vercel server service.
 * Vercel builds `dist/index.mjs`, then copies it to the configured `server.mjs`
 * entrypoint because the entrypoint must exist at the service root after build.
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
   * Vercel runs the resulting server.mjs under Bun. Bundling every dependency
   * makes that artifact self-contained instead of relying on workspace package
   * resolution inside the deployed function.
   */
  deps: { alwaysBundle: [/.*/] },
  /**
   * exceljs is inlined along with everything else.
   *
   * Left external it was the one specifier still resolved at runtime, and it
   * failed the same way everything else did — `ResolveMessage {}`, this time
   * caught by the route rather than killing the process. Bundling it removes
   * the last resolution from the deployment.
   *
   * Being CommonJS over a tree of dynamic requires, it is the module most
   * likely to resist bundling, which is why the export route still loads this
   * module lazily: if a dynamic require does slip through, the cost is a failed
   * download and not a server that will not boot.
   */
  /** One file, so there are no sibling chunks left to resolve or to package. */
  outputOptions: { codeSplitting: false },
});
