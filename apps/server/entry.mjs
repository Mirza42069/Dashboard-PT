/**
 * The deployed entrypoint. Three lines of indirection, and each one is load
 * bearing.
 *
 * vercel.json cannot point a service straight at dist/index.mjs: a service's
 * `entrypoint` is checked against the *cloned source tree*, roughly 65ms into
 * `vercel build` and well before installCommand or buildCommand run. dist/ is
 * gitignored, so that path never exists at check time and the deploy dies with
 *
 *   Error: Service "server" has entrypoint "dist/index.mjs" but that path
 *   does not exist.
 *
 * no matter what the build would have produced. This file is committed, so the
 * check passes; by the time anything imports it, tsdown has written the bundle
 * beside it.
 *
 * It cannot point at src/index.ts either. Bun then resolves the whole import
 * graph at cold start, and that graph leaves apps/server: bun installs a
 * workspace package's dependencies into *its* node_modules rather than hoisting
 * them, and file tracing does not follow the @DashboardV2/* symlinks out to
 * packages/*\/node_modules. The function boots, throws an empty
 * `ResolveMessage {}`, exits 1, and every /api route answers 500 — including
 * /api/auth/sign-in/email, so it reads as "login is broken" rather than as a
 * packaging fault. The web service is unaffected, which makes it look like an
 * auth bug. It is not.
 *
 * The bundle sidesteps both: tsdown inlines every @DashboardV2/* package, so
 * nothing outside apps/server is needed at runtime and there is no cross-
 * workspace resolution left to fail.
 */
export { default } from "./dist/index.mjs";
