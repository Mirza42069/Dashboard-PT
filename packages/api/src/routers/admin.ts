import {
  accountEmailConfigured,
  auth,
  sendPasswordSetupLink,
} from "@DashboardV2/auth";
import {
  isValidAccountName,
  normalizeAccountName,
  normalizeUsername,
} from "@DashboardV2/auth/username";
import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { company } from "@DashboardV2/db/schema/company";
import { project, projectMember } from "@DashboardV2/db/schema/construction";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, ilike, inArray, ne, or } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, permissionProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import {
  type AdminAction,
  interpolate,
  type MessageDictionary,
} from "../lib/messages/index";
import { roleOf } from "../lib/permissions";
import { assertCompanyExists } from "../lib/scope";
import {
  DEFAULT_TRIAL_AI_CREDITS,
  DEFAULT_TRIAL_DAYS,
  MAX_TRIAL_AI_CREDITS,
  MAX_TRIAL_DAYS,
  trialDeadline,
} from "../lib/trial";
import { planProjectAccessReconciliation } from "../lib/user-project-access";

const PASSWORD_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const LOCKED_PASSWORD_LENGTH = 32;

/** A valid credential that is never shown or sent; only the setup link can replace it. */
function generateLockedPassword() {
  const values = new Uint32Array(LOCKED_PASSWORD_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    PASSWORD_ALPHABET.charAt(value % PASSWORD_ALPHABET.length),
  ).join("");
}

function assertAccountEmailConfigured(t: MessageDictionary) {
  if (!accountEmailConfigured()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: t.user.accountEmailNotConfigured });
  }
}

function accountConflictField(error: unknown): "email" | "name" | null {
  const values: string[] = [];
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    const details = current as {
      body?: unknown;
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
    };
    for (const value of [details.code, details.constraint, details.message]) {
      if (typeof value === "string") values.push(value);
    }
    pending.push(details.body, details.cause);
  }

  const marker = values.join(" ");
  if (marker.includes("USERNAME_IS_ALREADY_TAKEN") || marker.includes("user_username_unique")) {
    return "name";
  }
  if (
    marker.includes("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") ||
    marker.includes("user_email_unique")
  ) {
    return "email";
  }
  return null;
}

async function trySendPasswordSetupLink({
  userId,
  email,
  headers,
}: {
  userId: string;
  email: string;
  headers: Headers;
}) {
  try {
    await sendPasswordSetupLink({ userId, email, headers });
    return true;
  } catch (error) {
    console.error("Failed to send password setup email", { userId, error });
    return false;
  }
}

const roleSchema = z.enum(["super_admin", "admin", "user"]);
const userIdSchema = z.object({ userId: z.string().min(1) });

/**
 * A trial, as an admin states it: a length and an allowance, both absolute.
 *
 * Absolute rather than "add 7 more days" because the admin is looking at the
 * account's current state when they decide — a delta means the answer depends
 * on how stale that screen is, and two admins acting on the same lapsed trial
 * would produce different deadlines.
 */
const trialInputSchema = z.object({
  days: z.number().int().min(1).max(MAX_TRIAL_DAYS).default(DEFAULT_TRIAL_DAYS),
  aiCredits: z.number().int().min(0).max(MAX_TRIAL_AI_CREDITS).default(DEFAULT_TRIAL_AI_CREDITS),
});

/**
 * Turns that into the two columns, or refuses.
 *
 * Super admins are excluded by role, not by hiding the control: a trial that
 * lapses locks the account out, and the one account type that can lift the
 * lock must never be able to lock itself out.
 */
function resolveTrialInput(
  t: MessageDictionary,
  trial: z.infer<typeof trialInputSchema> | undefined,
  role: z.infer<typeof roleSchema>,
) {
  if (!trial) return null;
  if (role === "super_admin") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: t.user.systemNoTrial,
    });
  }
  return { trialEndsAt: trialDeadline(trial.days), trialAiCredits: trial.aiCredits };
}

/**
 * Keeps project scope valid when account administration changes how access is
 * evaluated. Admins do not need membership rows; regular users do, and only in
 * their current company. Manager assignments never survive a company move.
 */
async function reconcileProjectAccess(
  userId: string,
  role: z.infer<typeof roleSchema>,
  companyId: string | null,
  accountChanges?: { companyId: string | null; role?: z.infer<typeof roleSchema> },
) {
  const [managedProjects, memberships] = await Promise.all([
    role === "user" && companyId
      ? db
          .select({ projectId: project.id })
          .from(project)
          .where(and(eq(project.managerId, userId), eq(project.companyId, companyId)))
      : Promise.resolve([]),
    db
      .select({ companyId: project.companyId, projectId: projectMember.projectId })
      .from(projectMember)
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(eq(projectMember.userId, userId)),
  ]);

  const { grantProjectIds, staleProjectIds } = planProjectAccessReconciliation({
    companyId,
    managedProjectIds: managedProjects.map(({ projectId }) => projectId),
    memberships,
    role,
  });

  await runBatch([
    ...(accountChanges
      ? [db.update(user).set(accountChanges).where(eq(user.id, userId))]
      : []),
    db
      .update(project)
      .set({ managerId: null })
      .where(
        companyId
          ? and(eq(project.managerId, userId), ne(project.companyId, companyId))
          : eq(project.managerId, userId),
      ),
    ...(staleProjectIds.length > 0
      ? [
          db
            .delete(projectMember)
            .where(
              and(
                eq(projectMember.userId, userId),
                inArray(projectMember.projectId, staleProjectIds),
              ),
            ),
        ]
      : []),
    ...(grantProjectIds.length > 0
      ? [
          db
            .insert(projectMember)
            .values(grantProjectIds.map((projectId) => ({ projectId, userId })))
            .onConflictDoNothing(),
        ]
      : []),
  ]);
}

async function countSuperAdmins() {
  const [row] = await db.select({ value: count() }).from(user).where(eq(user.role, "super_admin"));
  return row?.value ?? 0;
}

async function assertUserExists(t: MessageDictionary, userId: string) {
  const [target] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: t.user.notFound });
  }
}

/**
 * Refuses any change that would leave the dashboard with no way back in.
 * "Last way back in" is global, not per-tenant — a company without its own
 * admin is still fully manageable by any super_admin, so there is no
 * per-tenant lockout to protect against, only a total one.
 */
async function assertNotLastSuperAdmin(
  t: MessageDictionary,
  userId: string,
  action: AdminAction,
) {
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));

  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: t.user.notFound });
  }
  if (target.role !== "super_admin") {
    return;
  }
  if ((await countSuperAdmins()) <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: interpolate(t.user.notLastSuperAdmin, {
        action: t.enums.adminAction[action],
      }),
    });
  }
}

/**
 * A company Admin may only act on their own company's User accounts — not
 * fellow admins, not accounts in another tenant. A Super Admin acts on anyone
 * (subject to the other guards above). NOT_FOUND rather than FORBIDDEN on a
 * mismatch, matching the rest of the app's anti-leak convention.
 */
async function assertTargetManageable(
  ctx: {
    companyId: string;
    session: { user: { role?: string | null } };
    t: MessageDictionary;
  },
  targetUserId: string,
) {
  if (roleOf(ctx.session.user) === "super_admin") return;

  const [target] = await db
    .select({ role: user.role, companyId: user.companyId })
    .from(user)
    .where(eq(user.id, targetUserId));
  if (!target || target.role !== "user" || target.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.notFound });
  }
}

/** "Name - email" for the audit trail, resolved while the row still exists. */
async function userLabel(userId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row ? `${row.name} - ${row.email}` : userId;
}

function assertNotSelf(
  t: MessageDictionary,
  actorId: string,
  targetId: string,
  action: AdminAction,
) {
  if (actorId === targetId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: interpolate(t.user.notOwnAccount, { action: t.enums.adminAction[action] }),
    });
  }
}

/**
 * Which company an account-management event belongs to in the audit trail.
 *
 * The subject's own company, so "disabled Rina" shows up for the company Rina
 * works for. Super admins are unpinned, so events about them fall back to
 * whichever company the acting super admin is currently viewing — never
 * null, because the feed filters by equality and a null row would be written
 * and never seen again.
 */
async function auditCompanyFor(targetUserId: string, fallback: string): Promise<string> {
  const [target] = await db
    .select({ companyId: user.companyId })
    .from(user)
    .where(eq(user.id, targetUserId));
  return target?.companyId ?? fallback;
}

export const adminRouter = router({
  listUsers: companyPermissionProcedure("user:manage")
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Super admin: the cross-tenant directory. Admin: own company only —
      // this naturally includes fellow admins of the same company (visible,
      // not manageable) and excludes every super_admin (companyId is null).
      const isSuperAdmin = roleOf(ctx.session.user) === "super_admin";
      const filters = [
        input.search
          ? or(
              ilike(user.name, `%${input.search}%`),
              ilike(user.email, `%${input.search}%`),
            )
          : undefined,
        isSuperAdmin ? undefined : eq(user.companyId, ctx.companyId),
      ].filter(Boolean);
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            banned: user.banned,
            mustChangePassword: user.mustChangePassword,
            trialEndsAt: user.trialEndsAt,
            trialAiCredits: user.trialAiCredits,
            createdAt: user.createdAt,
            companyId: user.companyId,
            // Null for super admins, who are not pinned to a company.
            companyName: company.name,
          })
          .from(user)
          .leftJoin(company, eq(company.id, user.companyId))
          .where(where)
          .orderBy(desc(user.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(user).where(where),
      ]);

      return {
        users: rows,
        total: total?.value ?? 0,
        accountEmailEnabled: accountEmailConfigured(),
      };
    }),

  /**
   * Creates the account and returns the generated password ONCE. It is never
   * stored in plaintext and never logged — if the admin loses it, they reset it.
   */
  createUser: companyPermissionProcedure("user:manage")
    .input(
      z.object({
        name: z.string(),
        email: z.email("Invalid email address"),
        role: roleSchema.default("user"),
        /** Required for admin and user accounts — null (ignored) for super_admin, who is unpinned. */
        companyId: z.string().min(1).optional(),
        /** Omit for a normal account. Present means "start a trial now". */
        trial: trialInputSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertAccountEmailConfigured(ctx.t);
      const email = input.email.toLowerCase();
      if (!isValidAccountName(input.name)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.nameInvalid });
      }
      const name = normalizeAccountName(input.name);
      const username = normalizeUsername(name);

      const existing = await db
        .select({ email: user.email, username: user.username })
        .from(user)
        .where(or(eq(user.email, email), eq(user.username, username)));
      if (existing.some((account) => account.email === email)) {
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.emailExists });
      }
      if (existing.some((account) => account.username === username)) {
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.nameExists });
      }

      const actorIsSuperAdmin = roleOf(ctx.session.user) === "super_admin";
      let role = input.role;
      let companyId: string | null;

      if (!actorIsSuperAdmin) {
        // Company admin: may only create Users, only in their own company.
        if (input.role !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: ctx.t.user.onlySuperAdminCreatesAdmins,
          });
        }
        if (input.companyId && input.companyId !== ctx.companyId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: ctx.t.user.ownCompanyOnly,
          });
        }
        role = "user";
        companyId = ctx.companyId;
      } else if (input.role === "super_admin") {
        companyId = null;
      } else {
        if (!input.companyId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.company.pickOne });
        }
        await assertCompanyExists(ctx.t, input.companyId);
        companyId = input.companyId;
      }

      const trial = resolveTrialInput(ctx.t, input.trial, role);
      const lockedPassword = generateLockedPassword();

      const created = await auth.api
        .createUser({
          headers: ctx.headers,
          body: {
            email,
            password: lockedPassword,
            name,
            role,
            data: {
              username,
              displayUsername: name,
            },
          },
        })
        .catch((error: unknown) => {
          const conflict = accountConflictField(error);
          if (conflict === "name") {
            throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.nameExists, cause: error });
          }
          if (conflict === "email") {
            throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.emailExists, cause: error });
          }
          throw error;
        });

      // companyId is `input: false` on the auth side — it must never come in on
      // a request body — so it is written here rather than passed to createUser.
      //
      // The two writes cannot share a transaction (the Neon HTTP driver has no
      // interactive ones), and an account that exists with no company is locked
      // out of every page. So if the second write fails, undo the first rather
      // than leaving an account only raw SQL can repair.
      if (companyId || trial) {
        try {
          await db
            .update(user)
            .set({ ...(companyId ? { companyId } : {}), ...(trial ?? {}) })
            .where(eq(user.id, created.user.id));
        } catch (error) {
          await db.delete(user).where(eq(user.id, created.user.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: ctx.t.user.couldNotAssignCompany,
            cause: error,
          });
        }
      }

      const invitationSent = await trySendPasswordSetupLink({
        userId: created.user.id,
        email,
        headers: ctx.headers,
      });

      await recordActivity({ session: ctx.session, companyId: companyId ?? ctx.companyId }, {
        action: "created",
        entityType: "user",
        entityId: created.user.id,
        entityLabel: `${name} - ${email}`,
        detail: trial ? `${role} (trial)` : role,
      });

      return { user: created.user, invitationSent };
    }),

  renameUser: companyPermissionProcedure("user:rename")
    .input(
      userIdSchema.extend({
        name: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isValidAccountName(input.name)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.nameInvalid });
      }
      const name = normalizeAccountName(input.name);
      const username = normalizeUsername(name);
      const [target] = await db
        .select({
          name: user.name,
          email: user.email,
          username: user.username,
          displayUsername: user.displayUsername,
          companyId: user.companyId,
        })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.notFound });
      }
      if (
        target.name === name &&
        target.username === username &&
        target.displayUsername === name
      ) {
        return { success: true };
      }
      const [duplicate] = await db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.username, username), ne(user.id, input.userId)));
      if (duplicate) {
        throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.nameExists });
      }
      const previousLabel = `${target.name} - ${target.email}`;

      await auth.api
        .adminUpdateUser({
          headers: ctx.headers,
          body: {
            userId: input.userId,
            data: {
              name,
              displayUsername: name,
              ...(target.username === username ? {} : { username }),
            },
          },
        })
        .catch((error: unknown) => {
          if (accountConflictField(error) === "name") {
            throw new TRPCError({ code: "CONFLICT", message: ctx.t.user.nameExists, cause: error });
          }
          throw error;
        });

      // Unpinned System accounts are global. Filing their name/email under the
      // actor's currently selected tenant would leak global-account PII into a
      // company activity feed, so only tenant-owned accounts produce this row.
      if (target.companyId) {
        await recordActivity({ session: ctx.session, companyId: target.companyId }, {
          action: "updated",
          entityType: "user",
          entityId: input.userId,
          entityLabel: previousLabel,
          detail: name,
        });
      }

      return { success: true };
    }),

  resetPassword: companyPermissionProcedure("user:manage")
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      assertAccountEmailConfigured(ctx.t);
      assertNotSelf(ctx.t, ctx.session.user.id, input.userId, "resetPassword");
      await assertTargetManageable(ctx, input.userId);

      const [target] = await db
        .select({
          email: user.email,
          name: user.name,
          companyId: user.companyId,
          role: user.role,
        })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.notFound });
      }
      if (target.role === "super_admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: ctx.t.user.systemPasswordResetNotAllowed,
        });
      }

      await db
        .update(user)
        .set({ mustChangePassword: true, passwordSetupTokenHash: null })
        .where(eq(user.id, input.userId));

      await auth.api.setUserPassword({
        headers: ctx.headers,
        body: { userId: input.userId, newPassword: generateLockedPassword() },
      });
      await auth.api.revokeUserSessions({
        headers: ctx.headers,
        body: { userId: input.userId },
      });
      const invitationSent = await trySendPasswordSetupLink({
        userId: input.userId,
        email: target.email,
        headers: ctx.headers,
      });

      if (target.companyId) {
        await recordActivity(
          { session: ctx.session, companyId: target.companyId },
          {
            action: "updated",
            entityType: "user",
            entityId: input.userId,
            entityLabel: `${target.name} - ${target.email}`,
            detail: invitationSent ? "Password setup email sent" : "Password setup email failed",
          },
        );
      }

      return { invitationSent };
    }),

  /** Moves an account to another company. Super admins stay unpinned. */
  setCompany: permissionProcedure("user:setCompany")
    .input(userIdSchema.extend({ companyId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertCompanyExists(ctx.t, input.companyId);
      const [target] = await db
        .select({ id: user.id, role: user.role })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.notFound });
      }
      if (target.role === "super_admin") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: ctx.t.auth.superAdminNotPinned,
        });
      }
      if (target.role !== "admin" && target.role !== "user") {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.auth.unsupportedRole });
      }

      await reconcileProjectAccess(input.userId, target.role, input.companyId, {
        companyId: input.companyId,
      });
      return { success: true };
    }),

  setRole: companyPermissionProcedure("user:setRole")
    .input(userIdSchema.extend({ role: roleSchema, companyId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertUserExists(ctx.t, input.userId);
      if (input.role !== "super_admin") {
        await assertNotLastSuperAdmin(ctx.t, input.userId, "demote");
      }

      // A pinned account with no company resolves to "No company assigned" on
      // every request — i.e. a locked-out account. Any role but super_admin
      // must therefore land on some company: the one the account already had,
      // an explicit choice, or — for a super_admin, who is unpinned by
      // definition and so has neither — the company the acting super admin is
      // currently viewing. Without that last fallback, demoting any super
      // admin is impossible.
      const label = await userLabel(input.userId);
      let companyId: string | null = null;
      if (input.role !== "super_admin") {
        companyId = input.companyId ?? (await auditCompanyFor(input.userId, ctx.companyId));
        await assertCompanyExists(ctx.t, companyId);
      }

      // Promoting to super_admin unpins the account; any other role keeps or assigns one.
      await reconcileProjectAccess(input.userId, input.role, companyId, {
        companyId,
        role: input.role,
      });

      await recordActivity({ session: ctx.session, companyId: companyId ?? ctx.companyId }, {
        action: "role_changed",
        entityType: "user",
        entityId: input.userId,
        entityLabel: label,
        detail: input.role,
      });

      return { success: true };
    }),

  /**
   * Starts, re-times, or ends a trial.
   *
   * Deliberately not folded into setBanned. Pausing is a judgement an admin
   * makes about an account; a trial is a commercial arrangement with a clock,
   * and the two can be true at once — resuming a paused account must not also
   * hand it another week of trial, and extending a trial must not un-pause it.
   */
  setTrial: companyPermissionProcedure("user:manage")
    .input(
      z.union([
        userIdSchema.extend({ action: z.literal("clear") }),
        userIdSchema.extend({ action: z.literal("set") }).merge(trialInputSchema),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTargetManageable(ctx, input.userId);
      assertNotSelf(ctx.t, ctx.session.user.id, input.userId, "trial");
      const auditCompanyId = await auditCompanyFor(input.userId, ctx.companyId);

      const [target] = await db
        .select({ role: user.role, trialEndsAt: user.trialEndsAt })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.notFound });
      }

      const wasOnTrial = target.trialEndsAt !== null;

      if (input.action === "clear") {
        await db
          .update(user)
          .set({ trialEndsAt: null, trialAiCredits: null })
          .where(eq(user.id, input.userId));
      } else {
        // roleOf, not roleSchema.parse: a row carrying a legacy or unknown role
        // must degrade to the least-privileged one, not 500 the request.
        const fields = resolveTrialInput(ctx.t,
          { days: input.days, aiCredits: input.aiCredits },
          roleOf(target),
        );
        if (fields) {
          await db.update(user).set(fields).where(eq(user.id, input.userId));
        }
      }

      await recordActivity({ session: ctx.session, companyId: auditCompanyId }, {
        action:
          input.action === "clear"
            ? "trial_cleared"
            : wasOnTrial
              ? "trial_changed"
              : "trial_started",
        entityType: "user",
        entityId: input.userId,
        entityLabel: await userLabel(input.userId),
        detail:
          input.action === "set" ? `${input.days}d / ${input.aiCredits} AI` : undefined,
      });

      return { success: true };
    }),

  setBanned: companyPermissionProcedure("user:manage")
    .input(userIdSchema.extend({ banned: z.boolean(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertTargetManageable(ctx, input.userId);
      const auditCompanyId = await auditCompanyFor(input.userId, ctx.companyId);

      if (input.banned) {
        assertNotSelf(ctx.t, ctx.session.user.id, input.userId, "disable");
        await assertNotLastSuperAdmin(ctx.t, input.userId, "disable");

        await auth.api.banUser({
          headers: ctx.headers,
          body: { userId: input.userId, banReason: input.reason },
        });
      } else {
        await auth.api.unbanUser({
          headers: ctx.headers,
          body: { userId: input.userId },
        });

        const [resumed] = await db
          .select({ companyId: user.companyId, role: user.role })
          .from(user)
          .where(eq(user.id, input.userId));
        if (resumed && (resumed.role === "admin" || resumed.role === "user")) {
          await reconcileProjectAccess(input.userId, resumed.role, resumed.companyId);
        }
      }

      await recordActivity({ session: ctx.session, companyId: auditCompanyId }, {
        action: input.banned ? "paused" : "resumed",
        entityType: "user",
        entityId: input.userId,
        entityLabel: await userLabel(input.userId),
        detail: input.banned ? input.reason : undefined,
      });

      return { success: true };
    }),

  deleteUser: companyPermissionProcedure("user:manage")
    .input(userIdSchema)
    .mutation(async ({ ctx, input }) => {
      await assertTargetManageable(ctx, input.userId);
      assertNotSelf(ctx.t, ctx.session.user.id, input.userId, "delete");
      await assertNotLastSuperAdmin(ctx.t, input.userId, "delete");

      // Read the label and company before removal — afterwards there is nothing
      // left to name the row with, or to file it under.
      const label = await userLabel(input.userId);
      const auditCompanyId = await auditCompanyFor(input.userId, ctx.companyId);

      await auth.api.removeUser({
        headers: ctx.headers,
        body: { userId: input.userId },
      });

      await recordActivity({ session: ctx.session, companyId: auditCompanyId }, {
        action: "deleted",
        entityType: "user",
        entityId: input.userId,
        entityLabel: label,
      });

      return { success: true };
    }),
});
