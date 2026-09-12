import { createDb } from "@DashboardV2/db";
import * as schema from "@DashboardV2/db/schema/auth";
import { env, trustedOrigins } from "@DashboardV2/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { admin } from "better-auth/plugins";
import { username } from "better-auth/plugins/username";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { and, eq, inArray, isNull, like, sql } from "drizzle-orm";
import {
  isValidAccountName,
  normalizeAccountName,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "./username";

export function generateTemporaryPassword() {
  // Exclude ambiguous glyphs; rejection sampling avoids modulo bias.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "";
  while (password.length < 16) {
    for (const value of crypto.getRandomValues(new Uint8Array(32))) {
      if (value < 256 - (256 % alphabet.length)) password += alphabet[value % alphabet.length];
      if (password.length === 16) break;
    }
  }
  return password;
}

export async function hashInaccessiblePassword() {
  return hashPassword(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url"));
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
  const adapter = drizzleAdapter(db, { provider: "pg", schema });

  return betterAuth({
    database: (options: Parameters<typeof adapter>[0]) => {
      const delegate = adapter(options);
      const create = async <T extends Record<string, unknown>, R = T>(input: {
        model: string; data: Omit<T, "id">; select?: string[]; forceAllowId?: boolean;
      }): Promise<R> => {
          if (input.model !== "session") return delegate.create(input);
          const { credentialRevision, ...data } = input.data as unknown as typeof schema.session.$inferInsert & { credentialRevision?: string | null };
          if (credentialRevision === undefined) throw new Error("Session credential binding required");
          try {
            // Serialize insertion with reset/change/scope transactions. A before
            // hook alone leaves a gap between checking the revision and INSERT.
            const [, inserted] = await db.batch([
              db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.id, data.userId)).for("update"),
              db.insert(schema.session).select(db.select({
                id: sql<string>`${data.id ?? crypto.randomUUID()}`.as("id"),
                expiresAt: sql<Date>`${new Date(data.expiresAt).toISOString()}::timestamp`.as("expires_at"),
                token: sql<string>`${data.token}`.as("token"),
                createdAt: sql<Date>`${(data.createdAt ?? new Date()).toISOString()}::timestamp`.as("created_at"),
                updatedAt: sql<Date>`${(data.updatedAt ?? new Date()).toISOString()}::timestamp`.as("updated_at"),
                ipAddress: sql<string | null>`${data.ipAddress ?? null}`.as("ip_address"),
                userAgent: sql<string | null>`${data.userAgent ?? null}`.as("user_agent"),
                userId: schema.user.id,
                impersonatedBy: sql<string | null>`${data.impersonatedBy ?? null}`.as("impersonated_by"),
              }).from(schema.user).where(and(
                eq(schema.user.id, data.userId),
                credentialRevision === null ? isNull(schema.user.passwordSetupTokenHash) : eq(schema.user.passwordSetupTokenHash, credentialRevision),
                eq(schema.user.banned, false),
                sql`(${schema.user.trialEndsAt} IS NULL OR ${schema.user.trialEndsAt} > now())`,
              ))).returning(),
            ]);
            if (!inserted[0]) throw new Error("Stale credential");
            return inserted[0] as R;
          } catch {
            throw APIError.from("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Sign in again with your current password." });
          }
        };
      return { ...delegate, create };
    },
    // Not just CORS_ORIGIN: a preview is reachable on both its per-build and
    // its per-branch hostname. See trustedOrigins in packages/env/src/server.ts.
    trustedOrigins,
    // Only the scoped application procedures may write credentials.
    disabledPaths: ["/reset-password", "/request-password-reset", "/change-password", "/admin/set-user-password", "/admin/set-role"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (["/reset-password", "/request-password-reset", "/change-password", "/admin/set-user-password"].includes(ctx.path)) {
          throw APIError.from("NOT_FOUND", { code: "NOT_FOUND", message: "Not found" });
        }
        if (ctx.path === "/sign-in/email" || ctx.path === "/sign-in/username") {
          const identifier = ctx.path === "/sign-in/email" ? ctx.body?.email : ctx.body?.username;
          if (typeof identifier !== "string") return;
          const [snapshot] = await db.select({ id: schema.user.id, revision: schema.user.passwordSetupTokenHash })
            .from(schema.user).where(ctx.path === "/sign-in/email"
              ? eq(schema.user.email, identifier.toLowerCase())
              : eq(schema.user.username, normalizeUsername(identifier)));
          return { context: { context: { credentialSnapshot: snapshot ?? null } } };
        }
        if (ctx.path === "/admin/impersonate-user" && typeof ctx.body?.userId === "string") {
          // Better Auth still authorizes impersonation; bind its resulting
          // session to the target's pre-operation revision as well.
          const [snapshot] = await db.select({ id: schema.user.id, revision: schema.user.passwordSetupTokenHash })
            .from(schema.user).where(eq(schema.user.id, ctx.body.userId));
          return { context: { context: { credentialSnapshot: snapshot ?? null } } };
        }
      }),
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !opts.allowSignUp,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        // Set until the owner changes their temporary password. `input: false`
        // keeps it out of every request body —
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
            const snapshot = (ctx?.context as { credentialSnapshot?: { id: string; revision: string | null } } | undefined)?.credentialSnapshot;
            if (!snapshot || snapshot.id !== session.userId) {
              // Bootstrap sign-up is the only non-password session issuer.
              if (!opts.allowSignUp || ctx?.path !== "/sign-up/email") return false;
            }
            const account = await ctx?.context.internalAdapter.findUserById(session.userId);
            const endsAt = (account as { trialEndsAt?: Date | string | null } | null)?.trialEndsAt;
            if (endsAt && new Date(endsAt).getTime() <= Date.now()) {
              throw APIError.from("FORBIDDEN", {
                message: "This trial has ended. Ask an administrator to renew it.",
                code: TRIAL_ENDED_CODE,
              });
            }
            return { data: { ...session, credentialRevision: snapshot?.revision ?? null } };
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
        usernameNormalization: normalizeUsername,
        displayUsernameNormalization: normalizeAccountName,
        usernameValidator: isValidAccountName,
        displayUsernameValidator: isValidAccountName,
      }),
      admin({
        defaultRole: "user",
        // "admin" is here, not just "super_admin", because packages/api's
        // admin router calls auth.api.createUser/banUser/
        // unbanUser/removeUser with the *caller's* headers — better-auth
        // checks the caller against this list on every one of those calls,
        // and company admins must keep creating/banning their own
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

/** Server-only: the authorized target snapshot is rechecked under the row lock. */
export async function resetTemporaryPassword(userId: string, target: {
  role: string;
  companyId: string | null;
  pendingOnly: boolean;
}) {
  const temporaryPassword = generateTemporaryPassword();
  const db = createDb();
  try {
    // Reuse the persisted setup binding as an opaque credential revision, never
    // as a bearer token. A fresh revision also invalidates in-flight changes.
    const revision = crypto.randomUUID();
    const password = await hashPassword(temporaryPassword);
    const armedUser = db.select({ id: schema.user.id }).from(schema.user).where(and(
      eq(schema.user.id, userId), eq(schema.user.passwordSetupTokenHash, revision),
    ));
    // Neon HTTP batch is a transaction; lock the user before all other writes.
    const [armed] = await db.batch([
      db.update(schema.user)
        .set({ mustChangePassword: true, passwordSetupTokenHash: revision })
        .where(and(
          eq(schema.user.id, userId),
          eq(schema.user.role, target.role),
          target.companyId === null ? isNull(schema.user.companyId) : eq(schema.user.companyId, target.companyId),
          // A System account can ONLY be reissued while it is still pending,
          // even if it completed setup after the router's initial read.
          target.pendingOnly || target.role === "super_admin" ? eq(schema.user.mustChangePassword, true) : undefined,
          inArray(schema.user.id, db.select({ id: schema.account.userId }).from(schema.account).where(eq(schema.account.providerId, "credential"))),
        ))
        .returning({ id: schema.user.id }),
      db.update(schema.account).set({ password, updatedAt: new Date() }).where(and(
        inArray(schema.account.userId, armedUser), eq(schema.account.providerId, "credential"),
      )),
      db.delete(schema.session).where(inArray(schema.session.userId, armedUser)),
      db.delete(schema.verification).where(and(
        inArray(schema.verification.value, armedUser),
        like(schema.verification.identifier, "reset-password:%"),
      )),
    ]);
    if (armed.length === 0) throw new Error("Account not found");
  } catch {
    // Never expose driver errors or hashes through logs or error causes.
    throw new Error("Could not reset the password. Try again.");
  }
  return temporaryPassword;
}

export async function changeOwnPassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<boolean> {  if (!currentPassword || currentPassword.length > 128 || newPassword.length < 12 || newPassword.length > 128) return false;
  // Reject equivalent Unicode spellings, not just identical input strings.
  if (currentPassword.normalize("NFKC") === newPassword.normalize("NFKC")) return false;
  try {
    const db = createDb();
    const [credential] = await db.select({ password: schema.account.password, revision: schema.user.passwordSetupTokenHash })
      .from(schema.user).innerJoin(schema.account, eq(schema.account.userId, schema.user.id))
      .where(and(eq(schema.user.id, userId), eq(schema.account.providerId, "credential")));
    if (!credential?.password || !await verifyPassword({ hash: credential.password, password: currentPassword })) return false;
    const password = await hashPassword(newPassword);
    const revision = crypto.randomUUID();
    const changedUser = db.select({ id: schema.user.id }).from(schema.user)
      .where(and(eq(schema.user.id, userId), eq(schema.user.passwordSetupTokenHash, revision)));
    const [changed] = await db.batch([
      db.update(schema.user).set({ mustChangePassword: false, passwordSetupTokenHash: revision, updatedAt: new Date() })
        .where(and(eq(schema.user.id, userId),
          credential.revision === null ? isNull(schema.user.passwordSetupTokenHash) : eq(schema.user.passwordSetupTokenHash, credential.revision),
          sql`EXISTS (SELECT 1 FROM session WHERE id = ${sessionId} AND user_id = ${userId} AND expires_at > now())`,
          sql`EXISTS (SELECT 1 FROM account WHERE user_id = ${userId} AND provider_id = 'credential' AND password = ${credential.password})`,
        )).returning({ id: schema.user.id }),
      db.update(schema.account).set({ password, updatedAt: new Date() }).where(and(inArray(schema.account.userId, changedUser), eq(schema.account.providerId, "credential"))),
      db.delete(schema.session).where(and(inArray(schema.session.userId, changedUser), sql`${schema.session.id} <> ${sessionId}`)),
      db.delete(schema.verification).where(and(inArray(schema.verification.value, changedUser), like(schema.verification.identifier, "reset-password:%"))),
    ]);
    return changed.length === 1;
  } catch {
    throw new Error("Could not change the password. Try again.");
  }
}

/**
 * Self-service password reset for accounts the owner cannot sign into.
 *
 * Tokens live in the `verification` table under `reset-password:{userId}` —
 * the same namespace changeOwnPassword and resetTemporaryPassword already
 * clear, so any credential change elsewhere invalidates outstanding links for
 * free. Only the SHA-256 hash is stored; the plaintext token exists solely in
 * the email link. One outstanding token per account: a new request replaces
 * the old row, orphaning earlier links.
 */
const PASSWORD_RESET_TTL_MINUTES = 60;const RESET_TOKEN_PREFIX = "reset-password:";

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

export async function createPasswordResetToken(email: string): Promise<string | null> {
  const db = createDb();
  const [target] = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email.toLowerCase()));
  if (!target) return null;
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  await db.batch([
    db.delete(schema.verification).where(eq(schema.verification.identifier, RESET_TOKEN_PREFIX + target.id)),
    db.insert(schema.verification).values({
      id: crypto.randomUUID(),
      identifier: RESET_TOKEN_PREFIX + target.id,
      value: await sha256Hex(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000),
    }),
  ]);
  return token;
}

export async function consumePasswordResetToken(token: string, newPassword: string): Promise<boolean> {
  if (!token || token.length > 200 || newPassword.length < 12 || newPassword.length > 128) return false;
  try {
    const db = createDb();
    const [match] = await db.select({ id: schema.verification.id, identifier: schema.verification.identifier })
      .from(schema.verification)
      .where(and(
        eq(schema.verification.value, await sha256Hex(token)),
        like(schema.verification.identifier, `${RESET_TOKEN_PREFIX}%`),
        sql`${schema.verification.expiresAt} > now()`,
      ));
    if (!match) return false;
    const userId = match.identifier.slice(RESET_TOKEN_PREFIX.length);
    const [credential] = await db.select({ revision: schema.user.passwordSetupTokenHash })
      .from(schema.user).innerJoin(schema.account, eq(schema.account.userId, schema.user.id))
      .where(and(eq(schema.user.id, userId), eq(schema.account.providerId, "credential")));
    if (!credential) return false;
    const revision = crypto.randomUUID();
    // Statements after the user update re-evaluate this subquery against the
    // NEW revision they can now see — matching on the old one (the optimistic
    // guard below) would make the password and session writes match 0 rows.
    // This is the same two-cursor shape changeOwnPassword uses.
    const armedUser = db.select({ id: schema.user.id }).from(schema.user).where(and(
      eq(schema.user.id, userId),
      eq(schema.user.passwordSetupTokenHash, revision),
    ));
    // The single-use guarantee lives in the first write: the delete only
    // matches for the first consumer, and the whole batch commits or not at
    // all. `changed` is the user update — the second statement. Its WHERE
    // carries the optimistic guard: a revision rotated elsewhere (admin reset,
    // another consumer of this token) between our read and this write
    // invalidates the link.
    const [, changed] = await db.batch([
      db.delete(schema.verification).where(eq(schema.verification.id, match.id)),
      db.update(schema.user).set({ mustChangePassword: false, passwordSetupTokenHash: revision, updatedAt: new Date() })
        .where(and(
          eq(schema.user.id, userId),
          credential.revision === null ? isNull(schema.user.passwordSetupTokenHash) : eq(schema.user.passwordSetupTokenHash, credential.revision),
        )).returning({ id: schema.user.id }),
      db.update(schema.account).set({ password: await hashPassword(newPassword), updatedAt: new Date() })
        .where(and(inArray(schema.account.userId, armedUser), eq(schema.account.providerId, "credential"))),
      // The owner just proved they lost the old credential — every existing
      // session dies with it. There is no current session to spare.
      db.delete(schema.session).where(inArray(schema.session.userId, armedUser)),
    ]);
    return changed.length === 1;
  } catch {
    // Never expose driver errors or hashes through logs or error causes.
    throw new Error("Could not reset the password. Try again.");
  }
}

export type Auth = ReturnType<typeof createAuth>;
