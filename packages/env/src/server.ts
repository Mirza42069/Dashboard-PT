import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/** Vercel exposes bare hostnames; everything downstream wants a full origin. */
function toOrigin(value: string | undefined) {
  if (!value) return undefined;
  return value.startsWith("http") ? value : `https://${value}`;
}

// The immutable per-build URL (…-<hash>-<scope>.vercel.app). Unique to one
// deployment, so on a preview it is almost never the URL anyone actually opens.
const deploymentOrigin = toOrigin(process.env.VERCEL_URL);
// The stable per-branch alias (…-git-<branch>-<scope>.vercel.app). This is the
// link a `git push` preview gives you, and therefore the Origin the browser
// sends. It differs from VERCEL_URL on every single preview deployment.
const branchOrigin = toOrigin(process.env.VERCEL_BRANCH_URL);
const productionOrigin = toOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);

function getVercelOrigin() {
  // Preview prefers the branch alias: it is the hostname a human opens, so
  // deriving the auth base URL from it keeps baseURL and Origin on one host.
  return process.env.VERCEL_ENV === "production"
    ? (productionOrigin ?? deploymentOrigin)
    : (branchOrigin ?? deploymentOrigin ?? productionOrigin);
}

const vercelOrigin = getVercelOrigin();

const runtimeEnv = {
  ...process.env,
  // Public auth base: /api/auth bypasses the rewrite's path strip, so the
  // same URL works for incoming matching and generated callbacks
  BETTER_AUTH_URL:
    process.env.BETTER_AUTH_URL ?? (vercelOrigin ? `${vercelOrigin}/api/auth` : undefined),
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? vercelOrigin,
};

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.url(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    // Only read by scripts/seed-admin.ts to bootstrap the first admin account.
    // Optional, and deliberately unconstrained beyond a string: the seed script
    // does its own validation, so a leftover weak value can never stop the API
    // from booting.
    ADMIN_EMAIL: z.string().optional(),
    ADMIN_PASSWORD: z.string().optional(),
    ADMIN_NAME: z.string().optional(),
  },
  runtimeEnv: runtimeEnv,
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

/**
 * Every hostname this deployment can legitimately be reached on.
 *
 * A Vercel preview answers on at least two: the immutable VERCEL_URL and the
 * stable VERCEL_BRANCH_URL alias. The browser sends whichever one the user
 * opened as `Origin`, so trusting a single origin breaks sign-in on the other
 * — better-auth rejects the POST on the origin check, before it ever looks at
 * the password, and the UI can only show a generic failure. That reads exactly
 * like a wrong password, which is what makes it so hard to place.
 *
 * Only platform-provided values are listed. None of them come from the request,
 * so widening the list this way does not weaken the CSRF protection the origin
 * check exists to provide.
 */
export const trustedOrigins = [
  ...new Set(
    [env.CORS_ORIGIN, deploymentOrigin, branchOrigin, productionOrigin].filter(
      (origin): origin is string => Boolean(origin),
    ),
  ),
];
