import { createDb } from "@DashboardV2/db";
import * as schema from "@DashboardV2/db/schema/auth";
import { env, trustedOrigins } from "@DashboardV2/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { admin } from "better-auth/plugins";

/**
 * Without a `roles` map, better-auth's admin plugin types createUser/setRole
 * bodies as accepting only "user" | "admin" (its two built-in roles), which
 * rejects "super_admin" at compile time even though `adminRoles` below lists
 * it. Registering "super_admin" here — with the same statements as the
 * built-in "admin" role, since better-auth's own ban/impersonate/etc. actions
 * don't distinguish the two — is what makes it a type-level option too.
 */
const accessControl = createAccessControl(defaultStatements);
const adminRoleMap = {
  super_admin: accessControl.newRole(adminAc.statements),
  admin: adminAc,
  user: userAc,
};

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
    // Not just CORS_ORIGIN: a preview is reachable on both its per-build and
    // its per-branch hostname. See trustedOrigins in packages/env/src/server.ts.
    trustedOrigins,
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
        // The tenant this account is pinned to. Null for super admins, who
        // choose an active company instead — admin and user are both pinned.
        // `input: false` for the same reason as above: a user must never be
        // able to move themselves to another company by putting a companyId
        // in a request body.
        companyId: {
          type: "string",
          required: false,
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
        // "admin" is here, not just "super_admin", because packages/api's
        // admin router calls auth.api.createUser/setUserPassword/banUser/
        // unbanUser/removeUser with the *caller's* headers — better-auth
        // checks the caller against this list on every one of those calls,
        // and company admins must keep creating/resetting/banning their own
        // users. The raw HTTP admin surface this also unlocks is closed for
        // non-super-admins in apps/server/src/index.ts, since nothing but a
        // super admin needs it and tRPC (which does its own tenant scoping
        // before ever calling auth.api.*) is how every in-app flow gets here.
        adminRoles: ["super_admin", "admin"],
        roles: adminRoleMap,
      }),
    ],
  });
}

export const auth = createAuth();

export type Auth = ReturnType<typeof createAuth>;
