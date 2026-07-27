# DashboardV2

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines Next.js, Hono, TRPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **Next.js** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Hono** - Lightweight, performant server framework
- **tRPC** - End-to-end type-safe APIs
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth, admin-managed accounts only

## Accounts & access

This is an internal dashboard, so **public sign-up is disabled** — `POST /api/auth/sign-up/email`
rejects every request. Accounts exist only because an admin created them.

- Two roles: `admin` and `user`. Admins additionally see **Administration → Users**.
- An admin creates an account at `/admin/users`; the app generates a temporary password and shows
  it **once**. It is never stored in plaintext and never logged — if it's lost, reset it.
- The new user is forced through `/change-password` on first sign-in before reaching anything else.
- Route protection is two-layer: `apps/web/src/proxy.ts` does an optimistic session-cookie check at
  the edge, and every page under `app/(app)/` calls `requireSession()` / `requireAdmin()` from
  `apps/web/src/lib/session.ts` for the authoritative check. tRPC enforces it independently via
  `protectedProcedure` / `adminProcedure` in `packages/api/src/index.ts`.

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up (Neon, or anything Postgres-compatible).
2. Create `apps/server/.env` and `apps/web/.env` with the variables below. The authoritative schema
   is `packages/env/src/server.ts` and `packages/env/src/web.ts` — the app refuses to boot if a
   required variable is missing or malformed.

**`apps/server/.env`**

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require` |
| `BETTER_AUTH_SECRET` | yes | Session signing secret, **min 32 chars**. Generate with `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | local only | `http://localhost:3000/api/auth`. Must include the `/api/auth` path. Derived from `VERCEL_URL` on Vercel — leave unset there |
| `CORS_ORIGIN` | local only | `http://localhost:3001`. Derived from `VERCEL_URL` on Vercel — leave unset there |
| `ADMIN_EMAIL` | seed only | Read by `db:seed-admin` only, never by the running server |
| `ADMIN_PASSWORD` | seed only | **Min 12 chars.** Clear once the admin account exists |
| `ADMIN_NAME` | seed only | Defaults to `Administrator` |

**`apps/web/.env`**

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | yes | `http://localhost:3000` locally. The Vercel deploy overrides this to the same-origin path `/api` |

3. Apply the schema to your database:

```bash
bun run db:push
```

4. Create the first admin. Set `ADMIN_EMAIL` / `ADMIN_PASSWORD` (min 12 chars) / `ADMIN_NAME` in
   `apps/server/.env`, then:

```bash
bun run db:seed-admin
```

This is the only way to create the first account, since sign-up is closed. It is safe to re-run —
an existing account is re-promoted rather than duplicated. Remove the `ADMIN_*` values afterwards.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@DashboardV2/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Deployment

### First deploy checklist

1. `bun run deploy:setup` — links the repo to a Vercel project (`vercel link`).
2. `bun run env:production` — pushes `DATABASE_URL`, `BETTER_AUTH_SECRET` and
   `NEXT_PUBLIC_SERVER_URL` (forced to `/api`) to Vercel.
   `BETTER_AUTH_URL`, `CORS_ORIGIN` and `NODE_ENV` are **skipped** — they are derived from
   `VERCEL_URL` at runtime in `packages/env/src/server.ts`. The `ADMIN_*` seed credentials are
   skipped too, and must never become deployment env vars.
3. Apply the schema to the production database. `db:push` reads `DATABASE_URL` from
   `apps/server/.env`, so point that at the production database first (or export the variable for
   the one command).
4. Create the first admin against that same database with `bun run db:seed-admin`, then clear the
   `ADMIN_*` values from `apps/server/.env`.
5. `bun run deploy:prod`.

Repeat steps 3–4 for any preview database. Preview deployments get their own `VERCEL_URL`, so auth
URLs and CORS follow automatically — no per-preview configuration.

### Notes

- **Session cookies** are `HttpOnly; Secure; SameSite=Lax` in production and drop `Secure` in
  development so plain-http localhost works in every browser (Safari rejects `Secure` over http,
  even on localhost). `Lax` is correct here because `vercel.json` serves the web app and the API
  from one origin; it is what keeps tRPC mutations out of reach of cross-site requests. If you ever
  split the two onto different domains, this has to change — see
  `packages/auth/src/index.ts`.
- **Sign-up stays disabled in every environment.** New deployments have zero accounts until you run
  the seed script.
- `packages/db` depends on `pg` **only as a devDependency**, for the drizzle-kit CLI. The deployed
  server uses the Neon HTTP driver and never loads it.

### Vercel Services

- Target: web + server
- Config: `vercel.json`
- Link the project first: bun run deploy:setup
- Local Vercel dev: bun run dev:vercel
- Sync preview env: bun run env:preview
- Sync production env: bun run env:production
- Dry-run check (no upload): bun run deploy:check
- Preview deploy: bun run deploy
- Production deploy: bun run deploy:prod
- Web requests under `/api/*` route to the server service and are rewritten before reaching the backend.
  Vercel Services share project environment variables, but deploys do not upload local `.env` files automatically. Link the project with `vercel link`, then run the env sync command before your first deploy (otherwise the deployment starts with no env vars), or pass one-off envs with `vercel deploy -e KEY=value`.
  Pass Vercel CLI flags to the env sync command directly, for example: `bun run env:production --scope your-team`.

For more details, see the guide on [Deploying to Vercel](https://www.better-t-stack.dev/docs/guides/vercel).

## Project Structure

```
DashboardV2/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Backend API (Hono, TRPC)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to database
- `bun run db:seed-admin`: Create/promote the first admin account from the `ADMIN_*` env vars
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run deploy:setup`: Link this repo to a Vercel project (first-time setup)
- `bun run dev:vercel`: Run the Vercel Services dev environment locally
- `bun run env:preview`: Sync local env files to the Vercel preview environment
- `bun run env:production`: Sync local env files to the Vercel production environment
- `bun run deploy`: Create a Vercel preview deployment
- `bun run deploy:prod`: Deploy to Vercel production
- `bun run deploy:check`: Dry-run a deploy to preview framework detection and included files without uploading
