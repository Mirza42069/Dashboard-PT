import { createDb } from "@DashboardV2/db";
import * as schema from "@DashboardV2/db/schema/auth";
import { env } from "@DashboardV2/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";

export type CreateAuthOptions = {
  /**
   * Opens the sign-up endpoint. This is an internal dashboard: accounts are
   * created by an admin, never by the visitor, so the only caller that passes
   * true is scripts/seed-admin.ts bootstrapping the very first admin.
   */
  allowSignUp?: boolean;
};

export function createAuth(opts: CreateAuthOptions = {}) {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
      disableSignUp: !opts.allowSignUp,
    },
    user: {
      additionalFields: {
        // Set when an admin issues a temporary password; cleared once the user
        // picks their own. `input: false` keeps it out of every request body —
        // it is only ever written server-side.
        mustChangePassword: {
          type: "boolean",
          defaultValue: true,
          input: false,
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        // "lax", not "none": vercel.json serves the web app and the API from a
        // single origin via rewrites, so the cookie is never needed on a
        // cross-site request. "none" would attach it to cross-site POSTs, and
        // CORS does not prevent such a request from executing — only from being
        // read — which would leave tRPC mutations open to CSRF.
        //
        // Locally, :3001 -> :3000 is still same-site (port is not part of a
        // "site"), so this works in development too.
        sameSite: "lax",
        // Plain http in development. Relying on the browser's localhost
        // exception for Secure cookies is not portable — Safari rejects them.
        secure: env.NODE_ENV === "production",
        httpOnly: true,
      },
    },
    plugins: [
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
      }),
    ],
  });
}

export const auth = createAuth();

export type Auth = ReturnType<typeof createAuth>;
