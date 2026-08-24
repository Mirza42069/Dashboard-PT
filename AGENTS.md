# Repository Guide

## Tooling and commands

- Use Bun 1.3.6 from the repository root; dependencies and workspace versions are controlled by `bun.lock` and the root catalog. Install with `bun install --frozen-lockfile`.
- `bun run dev` first kills listeners on ports 3000, 3001, and 3002, then starts the Hono API, dashboard, and marketing site. Use `bun run dev:server`, `bun run dev:web`, or `bun run dev:marketing` when that destructive port cleanup is unwanted.
- The local endpoints are API `:3000`, dashboard `:3001`, and marketing `:3002`.
- Run all checks with `bun run check-types`, `bun test`, and `bun run build`. There is no configured lint or formatter command.
- Run one test file with `bun test path/to/file.test.ts`; filter test names with `bun test -t "name"`. Tests are colocated with source rather than kept in a separate test tree.
- `bun run release:check` is the authoritative release sequence: types, tests, Drizzle schema check, build, then Vercel dry-run.

## Boundaries and entrypoints

- `apps/web` is the authenticated Next.js dashboard; `apps/marketing` is a separate Next.js site; `apps/server/src/index.ts` is the Hono entrypoint. Root `vercel.json` deploys web plus server and rewrites `/api/*` to the server; marketing has its own `apps/marketing/vercel.json` deployment.
- Business procedures and authorization live in `packages/api`; database schema and migrations live in `packages/db/src/schema` and `packages/db/src/migrations`; Better Auth setup lives in `packages/auth`; validated environment access lives in `packages/env`.
- Shared dashboard primitives belong in `packages/ui` and are imported through `@DashboardV2/ui/*`. Its Tailwind stylesheet is `packages/ui/src/styles/globals.css`, even when running shadcn from `apps/web`.
- Internal packages export TypeScript source directly; they do not have independent build outputs. Use their declared `@DashboardV2/*` exports rather than reaching across workspace directories.
- Tenant data procedures must use `companyProcedure` or `companyPermissionProcedure`, not plain `protectedProcedure`; this makes `ctx.companyId` the enforced tenant boundary.

## Environment and database

- Server and Drizzle configuration load `apps/server/.env`. Required local server values are `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), `BETTER_AUTH_URL`, and `CORS_ORIGIN`; the dashboard also requires `NEXT_PUBLIC_SERVER_URL` (normally `http://localhost:3000` locally and `/api` in the combined Vercel deployment).
- Database commands run through the root aliases: `bun run db:check`, `db:generate`, `db:migrate`, `db:push`, and `db:studio`. Generated migrations belong under `packages/db/src/migrations`; do not hand-edit schema changes only in the database.
- Seed commands explicitly load `apps/server/.env`: `bun run db:seed-admin`, `db:seed-demo`, and `db:seed-portfolio`.

## Framework and deployment traps

- Before changing either Next app, consult its installed Next 16 docs under `node_modules/next/dist/docs/`. `next dev` may regenerate app-level `AGENTS.md` files; they are generated duplicates, not additional repository guidance.
- Both Next apps enable typed routes and React Compiler. Do not add memoization solely as a default optimization, and keep route values compatible with typed routes.
- The server deploy must remain a self-contained single-file bundle. `apps/server/tsdown.config.ts` intentionally bundles every dependency with code splitting disabled; runtime dependencies used through workspace packages must also be direct dependencies of `apps/server` so Vercel can trace them.
- The server Vercel build runs `db:migrate` before building. Treat migration compatibility as part of deployment safety, not as a separate post-deploy step.
