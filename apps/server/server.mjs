/**
 * PLACEHOLDER — overwritten by the build. See vercel.json's `buildCommand`,
 * which runs tsdown and copies dist/index.mjs over this file.
 *
 * It is committed, and that is the entire point. A service's `entrypoint` is
 * checked against the *cloned* source tree moments into `vercel build`, long
 * before installCommand or buildCommand run, so it must name a path that exists
 * in git — pointing it straight at dist/index.mjs fails with
 *
 *   Error: Service "server" has entrypoint "dist/index.mjs" but that path
 *   does not exist.
 *
 * Vercel then runs this file under Bun rather than bundling it, which is why
 * the bundle has to land *here*, at a tracked path, rather than being imported
 * from dist/. An earlier attempt used a committed entry.mjs that re-exported
 * ./dist/index.mjs and still died at cold start: dist/ is gitignored and does
 * not appear to be packaged into the function at all.
 *
 * Running the build locally overwrites this file, so `git status` will show it
 * modified. Do not commit that — `git checkout apps/server/server.mjs` first.
 *
 * If you are reading this text in a deployment log or an HTTP response, the
 * build did not run and the placeholder shipped as-is.
 */
throw new Error(
  "apps/server/server.mjs is the un-built placeholder: the deploy shipped it " +
    "without running `bun run build && cp dist/index.mjs server.mjs`. Check " +
    "the server service's buildCommand in vercel.json.",
);
