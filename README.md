# Fushin — Construction Progress Dashboard

SaaS dashboard for construction progress reporting: BoQ baselines, schedules, S-curves, daily/weekly progress, and print-ready Excel exports.

## Tech Stack

- **Runtime & tooling** — [Bun](https://bun.sh) 1.3, TypeScript (strict), Bun test, Bun workspaces
- **Backend** — [Hono](https://hono.dev) HTTP server, [tRPC v11](https://trpc.io) for typed procedures, [Effect TS](https://effect.website) for typed, composable backend flows (guarded writes, advisory-locked batches, structured error channels), [Better Auth](https://www.better-auth.com) for sessions/auth, [Zod](https://zod.dev) for validation
- **Database** — PostgreSQL (Neon) with [Drizzle ORM](https://orm.drizzle.team); SQL migrations in `packages/db/src/migrations`
- **Frontend** — [Next.js](https://nextjs.org) 16 (App Router, typed routes, React Compiler) + React 19, [Tailwind CSS v4](https://tailwindcss.com) + shadcn/ui primitives (`packages/ui`)
- **Documents & AI** — [ExcelJS](https://exceljs.github.io) (workbook import/export), [pdf-lib](https://pdf-lib.js.org), Vercel AI Gateway (`ai` SDK) for workbook/PDF layout interpretation
- **Infrastructure** — Vercel (dashboard + API in one deployment, marketing site separate), [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) for uploads
