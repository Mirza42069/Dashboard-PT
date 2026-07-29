# V2 — Construction Management

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
- **Authentication** - Better-Auth, admin-managed accounts onl

## Environment variables

No template files are kept in the repo — this section is the reference.

`apps/server/.env`

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (Neon) |
| `BETTER_AUTH_SECRET` | 32 characters minimum |
| `BETTER_AUTH_URL` | Auth base, ends in `/api/auth` |
| `CORS_ORIGIN` | Origin the browser calls from |

`apps/web/.env`

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SERVER_URL` | `/api` in deployed environments |
| `DATABASE_URL` | Same value as the server's |
| `BETTER_AUTH_SECRET` | Same value as the server's |
| `BETTER_AUTH_URL` | Same value as the server's |
| `CORS_ORIGIN` | Same value as the server's |

The web app needs the four auth/database variables because `lib/session.ts`
resolves the session in-process through `@DashboardV2/auth` rather than over
HTTP to the API service. They are read while the routes are compiled, not just
at runtime, so a web build without them fails with `Invalid environment\\\
variables` rather than failing later at request time.

On Vercel this needs no extra setup: environment variables are project-scoped
and both services live in one project, so the web service already sees them.
`bun run env:preview` / `bun run env:production` push both `.env` files up.
