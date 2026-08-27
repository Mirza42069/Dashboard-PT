import { createDb } from "@DashboardV2/db";
import * as schema from "@DashboardV2/db/schema/auth";
import { env, trustedOrigins } from "@DashboardV2/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { admin } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";
import { APIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { and, eq, like } from "drizzle-orm";
import { Resend } from "resend";

import { passwordSetupEmail } from "./password-setup-email";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from "./username";

const PASSWORD_SETUP_HASH_HEADER = "x-fushin-password-setup-hash";

async function hashPasswordSetupToken(token: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return Buffer.from(signed).toString("hex");
}

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

/**
 * The error code a sign-in attempt carries when the trial is over, so the form
 * can tell it apart from BANNED_USER — "renew your subscription" is the wrong
 * instruction for a trial that simply lapsed.
 *
 * Mirrors TRIAL_ENDED_CODE in packages/api/src/lib/trial.ts, which is where the
 * client reads it from: that module is import-free and safe in the browser
 * bundle, and this package is not. Importing it here would make api and auth
 * mutually dependent.
 */
const TRIAL_ENDED_CODE = "TRIAL_ENDED";

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
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 24 * 60 * 60,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url, token }) {
        if (!env.RESEND_API_KEY) {
          throw new Error("Account email delivery is not configured.");
        }
        const armed = await db
          .update(schema.user)
          .set({ passwordSetupTokenHash: await hashPasswordSetupToken(token) })
          .where(
            and(
              eq(schema.user.id, user.id),
              eq(schema.user.mustChangePassword, true),
            ),
          )
          .returning({ id: schema.user.id });
        if (armed.length === 0) {
          throw new Error("This account no longer requires password setup.");
        }
        const message = passwordSetupEmail({ name: user.name, email: user.email, url });
        const result = await new Resend(env.RESEND_API_KEY).emails.send({
          from: env.ACCOUNT_EMAIL_FROM,
          to: user.email,
          ...message,
        });
        if (result.error) throw new Error(result.error.message);
      },
      async onPasswordReset({ user }, request) {
        const tokenHash = request?.headers.get(PASSWORD_SETUP_HASH_HEADER);
        if (!tokenHash) {
          throw APIError.from("BAD_REQUEST", {
            code: "INVALID_TOKEN",
            message: "The password setup link is invalid or has expired.",
          });
        }
        const unlocked = await db
          .update(schema.user)
          .set({ mustChangePassword: false, passwordSetupTokenHash: null })
          .where(
            and(
              eq(schema.user.id, user.id),
              eq(schema.user.passwordSetupTokenHash, tokenHash),
            ),
          )
          .returning({ id: schema.user.id });
        if (unlocked.length === 0) {
          const replacement = await hashPassword(`${crypto.randomUUID()}${crypto.randomUUID()}`);
          await Promise.all([
            db
              .update(schema.account)
              .set({ password: replacement })
              .where(
                and(
                  eq(schema.account.userId, user.id),
                  eq(schema.account.providerId, "credential"),
                ),
              ),
            db.delete(schema.session).where(eq(schema.session.userId, user.id)),
          ]);
          throw APIError.from("BAD_REQUEST", {
            code: "INVALID_TOKEN",
            message: "A newer password setup link has been issued.",
          });
        }
      },
    },
    user: {
      additionalFields: {
        // Set while an account is waiting for password setup; cleared once the
        // one-time link succeeds. `input: false` keeps it out of every request body —
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
        // Trial limits. Null trialEndsAt means "not a trial account"; see the
        // column comments in packages/db/src/schema/auth.ts. `input: false`
        // for the obvious reason — an account must not be able to extend its
        // own trial or top up its own credits by putting them in a body.
        trialEndsAt: {
          type: "date",
          required: false,
          input: false,
        },
        trialAiCredits: {
          type: "number",
          required: false,
          input: false,
        },
      },
    },
    /**
     * Refuses a new session to an account whose trial has run out.
     *
     * This mirrors how the admin plugin enforces `banned` — it registers the
     * same session.create.before hook, and better-auth runs both rather than
     * letting one replace the other. Checking here rather than on every
     * request is what keeps a trial free: `getSession` reads the user row it
     * already loaded, and this runs only at sign-in.
     *
     * A session created before the deadline outlives it, which is why
     * requireSession in apps/web also checks — see lib/session.ts. The same
     * belt covers the case where better-auth calls this without an endpoint
     * context and the user row cannot be read: the page and procedure gates
     * still refuse, so a lapsed trial cannot reach anything either way.
     */
    databaseHooks: {
      session: {
        create: {
          async before(session, ctx) {
            const account = await ctx?.context.internalAdapter.findUserById(session.userId);
            const endsAt = (account as { trialEndsAt?: Date | string | null } | null)?.trialEndsAt;
            if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
              throw APIError.from("FORBIDDEN", {
                message: "This trial has ended. Ask an administrator to renew it.",
                code: TRIAL_ENDED_CODE,
              });
            }
          },
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
      username({
        minUsernameLength: USERNAME_MIN_LENGTH,
        maxUsernameLength: USERNAME_MAX_LENGTH,
        usernameValidator: (value) => USERNAME_PATTERN.test(value),
      }),
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

export function accountEmailConfigured() {
  return env.ACCOUNT_EMAIL_ENABLED && Boolean(env.RESEND_API_KEY);
}

export async function verifyPasswordSetupToken(token: string) {
  const db = createDb();
  const [verification] = await db
    .select({ expiresAt: schema.verification.expiresAt, userId: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, `reset-password:${token}`));
  if (!verification || verification.expiresAt <= new Date()) return null;

  const [account] = await db
    .select({ tokenHash: schema.user.passwordSetupTokenHash })
    .from(schema.user)
    .where(eq(schema.user.id, verification.userId));
  const tokenHash = await hashPasswordSetupToken(token);
  if (!account?.tokenHash || account.tokenHash !== tokenHash) return null;
  return tokenHash;
}

export { PASSWORD_SETUP_HASH_HEADER };

export async function sendPasswordSetupLink({
  userId,
  email,
  headers,
}: {
  userId: string;
  email: string;
  headers: Headers;
}) {
  if (!accountEmailConfigured()) {
    throw new Error("Account email delivery is not configured.");
  }
  await createDb()
    .delete(schema.verification)
    .where(
      and(
        eq(schema.verification.value, userId),
        like(schema.verification.identifier, "reset-password:%"),
      ),
    );
  await auth.api.requestPasswordReset({
    headers,
    body: { email, redirectTo: `${env.CORS_ORIGIN}/set-password` },
  });
}

export type Auth = ReturnType<typeof createAuth>;
