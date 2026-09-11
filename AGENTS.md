# Repository Guide

## Tooling and commands

- Use Bun 1.3.6 from the repository root; dependencies and workspace versions are controlled by `bun.lock` and the root catalog. Install with `bun install --frozen-lockfile`.
- `bun run dev` kills listeners on API `:3000`, dashboard `:3001`, and marketing `:3002` before starting them. `bun run dev:server`, `bun run dev:web`, and `bun run dev:marketing` start individually without that cleanup; `bun run dev:stop` frees all three ports.
- Checks: `bun run check-types`, `bun test`, `bun run build`. Focus an app/UI typecheck with `bun run --filter web check-types` (also `server`, `marketing`, `@DashboardV2/ui`). There is no lint or formatter script.
- Tests are colocated: `bun test path/to/file.test.ts` or `bun test -t "name"`. Several API/auth/server suites skip without `DATABASE_URL`; load the server environment with `bun --env-file=apps/server/.env test [path/to/file.test.ts]`.
- `packages/auth/src/temporary-password.integration.test.ts` additionally requires `PASSWORD_SETUP_TEST_DATABASE_URL` pointing to a disposable localhost database named `auth_setup_test`; it creates and drops tables.
- `bun run release:check` orders typecheck, tests, `db:check`, build, then `deploy:check` (Vercel dry-run).

## Boundaries and entrypoints

- `apps/server/src/index.ts` wires Hono to `packages/api/src/routers/index.ts` and Better Auth (`packages/auth`). Dashboard server renders call the router in-process through `apps/web/src/utils/trpc-server.tsx`; browser calls use `utils/trpc.ts` over HTTP.
- Shared dashboard primitives belong in `packages/ui` and are imported through `@DashboardV2/ui/*`. Its Tailwind stylesheet is `packages/ui/src/styles/globals.css`, even when running shadcn from `apps/web`.
- Internal packages export TypeScript source directly; they do not have independent build outputs. Use their declared `@DashboardV2/*` exports rather than reaching across workspace directories.
- Tenant procedures use `companyProcedure` or `companyPermissionProcedure` and scope queries to `ctx.companyId`. Reuse `packages/api/src/lib/scope.ts`: `projectAccessFilter` for lists, `assertProjectAccess` for reads, `assertProjectWritable` for mutations (archived projects remain readable).
- `apps/web/src/proxy.ts` only checks cookie presence. Protected pages must use `requireSession`/`requirePermission` from `src/lib/session.ts` for real session, trial, and forced-password-change checks.
- Dashboard copy has English/Indonesian dictionaries in `apps/web/src/i18n`; API messages use `packages/api/src/lib/messages` via `ctx.t`/`tFor`. Update both languages; the default is Indonesian.

## Environment and database

- Server dev and Drizzle load `apps/server/.env`. `packages/env/src/server.ts` requires `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters), `BETTER_AUTH_URL`, and `CORS_ORIGIN` locally. The dashboard also imports auth/database code, so supply these to its runtime too; its client additionally requires `NEXT_PUBLIC_SERVER_URL` (`http://localhost:3000` locally, `/api` on Vercel).
- Database commands run through root aliases: `bun run db:check`, `db:generate`, `db:migrate`, `db:push`, `db:studio`. Edit `packages/db/src/schema`, then generate migrations into `packages/db/src/migrations`; database-only changes will not survive deployment.
- Seed commands explicitly load `apps/server/.env`: `bun run db:seed-admin`, `db:seed-demo`, and `db:seed-portfolio`.

## Framework and deployment traps

- Before changing either Next app, consult `apps/web/node_modules/next/dist/docs/` or `apps/marketing/node_modules/next/dist/docs/`; Next is not installed at root `node_modules/next`. `next dev` may create/update app-level `AGENTS.md`/`CLAUDE.md` managed blocks; keep custom guidance outside those blocks.
- Both Next apps enable typed routes and React Compiler. Do not add memoization solely as a default optimization, and keep route values compatible with typed routes.
- Root `vercel.json` deploys dashboard + server; marketing deploys separately via `apps/marketing/vercel.json`. `/api/*` routes to Hono with `/api` stripped, except `/api/auth/*`, which must retain its prefix. Hono also normalizes the original URL for tRPC.
- `apps/server/tsdown.config.ts` bundles every dependency with code splitting disabled. Keep the deploy self-contained: Vercel runs `db:migrate`, builds `dist/index.mjs`, then copies it to the service-root `server.mjs` entrypoint.
