/**
 * Bootstraps the first super admin account.
 *
 * Public sign-up is disabled (see packages/auth/src/index.ts), so there is no
 * way to create the very first account through the app — this script is the
 * only door in. It builds its own auth instance with sign-up temporarily
 * enabled, creates the user through the supported API so the password is
 * hashed the same way better-auth expects, then promotes it to super_admin —
 * the only role the UI itself cannot mint from nothing, since every other
 * role is created by an existing admin.
 *
 * Run with: bun run db:seed-admin
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from apps/server/.env.
 * Safe to re-run: an existing account is re-promoted, never duplicated.
 */
import { createAuth } from "@DashboardV2/auth";
import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { env } from "@DashboardV2/env/server";
import { eq } from "drizzle-orm";
import z from "zod";

const MIN_PASSWORD_LENGTH = 12;

/**
 * Validated here rather than in packages/env so that a leftover or weak
 * ADMIN_PASSWORD can never prevent the API server from starting.
 */
const credentialsSchema = z.object({
  email: z.email("ADMIN_EMAIL must be a valid email address"),
  password: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`),
  name: z.string().min(1),
});

async function main() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.error(
      "Missing ADMIN_EMAIL and/or ADMIN_PASSWORD.\n" +
        "Add them to apps/server/.env (see the Database Setup table in README.md), then re-run.",
    );
    process.exit(1);
  }

  const parsed = credentialsSchema.safeParse({
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    name: env.ADMIN_NAME ?? "Administrator",
  });

  if (!parsed.success) {
    // Only the messages — never the values.
    console.error(parsed.error.issues.map((issue) => `- ${issue.message}`).join("\n"));
    process.exit(1);
  }

  const { email, password, name } = parsed.data;

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email));

  if (existing.length === 0) {
    // Sign-up is closed on the shared `auth` instance, so use a local one.
    const seedAuth = createAuth({ allowSignUp: true });
    await seedAuth.api.signUpEmail({ body: { email, password, name } });
    console.log(`Created account ${email}`);
  } else {
    console.log(`Account ${email} already exists — re-asserting super admin role`);
  }

  await db
    .update(user)
    .set({ role: "super_admin", mustChangePassword: false, emailVerified: true, companyId: null })
    .where(eq(user.email, email));

  console.log(`${email} is a super admin. Sign in at http://localhost:3001/login`);
}

main().catch((error) => {
  // Never surface the password, even inside an error payload.
  console.error("Failed to seed admin:", error instanceof Error ? error.message : error);
  process.exit(1);
});
