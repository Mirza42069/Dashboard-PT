import { auth } from "@DashboardV2/auth";
import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { company } from "@DashboardV2/db/schema/company";
import { TRPCError } from "@trpc/server";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import z from "zod";

import { adminCompanyProcedure, adminProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { assertCompanyExists } from "../lib/scope";

/**
 * Ambiguous glyphs (0/O, 1/l/I) are excluded — these passwords get read aloud
 * or copied off a screen.
 */
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16;

function generateTempPassword() {
  const values = new Uint32Array(TEMP_PASSWORD_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (value) =>
    PASSWORD_ALPHABET.charAt(value % PASSWORD_ALPHABET.length),
  ).join("");
}

const roleSchema = z.enum(["admin", "user"]);
const userIdSchema = z.object({ userId: z.string().min(1) });

async function countAdmins() {
  const [row] = await db.select({ value: count() }).from(user).where(eq(user.role, "admin"));
  return row?.value ?? 0;
}

/**
 * Refuses any change that would leave the dashboard with no way back in.
 */
async function assertNotLastAdmin(userId: string, action: string) {
  const [target] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));

  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  if (target.role !== "admin") {
    return;
  }
  if ((await countAdmins()) <= 1) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot ${action} the last remaining admin`,
    });
  }
}

/** "Name · email" for the audit trail, resolved while the row still exists. */
async function userLabel(userId: string): Promise<string> {
  const [row] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row ? `${row.name} · ${row.email}` : userId;
}

function assertNotSelf(actorId: string, targetId: string, action: string) {
  if (actorId === targetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `You cannot ${action} your own account` });
  }
}

/**
 * Which company an account-management event belongs to in the audit trail.
 *
 * The subject's own company, so "disabled Rina" shows up for the company Rina
 * works for. Admins are unpinned, so events about them fall back to whichever
 * company the acting admin is currently viewing — never null, because the feed
 * filters by equality and a null row would be written and never seen again.
 */
async function auditCompanyFor(targetUserId: string, fallback: string): Promise<string> {
  const [target] = await db
    .select({ companyId: user.companyId })
    .from(user)
    .where(eq(user.id, targetUserId));
  return target?.companyId ?? fallback;
}

export const adminRouter = router({
  listUsers: adminProcedure
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const filter = input.search
        ? or(ilike(user.name, `%${input.search}%`), ilike(user.email, `%${input.search}%`))
        : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            banned: user.banned,
            mustChangePassword: user.mustChangePassword,
            createdAt: user.createdAt,
            companyId: user.companyId,
            // Null for admins, who are not pinned to a company.
            companyName: company.name,
          })
          .from(user)
          .leftJoin(company, eq(company.id, user.companyId))
          .where(filter)
          .orderBy(desc(user.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(user).where(filter),
      ]);

      return { users: rows, total: total?.value ?? 0 };
    }),

  /**
   * Creates the account and returns the generated password ONCE. It is never
   * stored in plaintext and never logged — if the admin loses it, they reset it.
   */
  createUser: adminCompanyProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: z.email("Invalid email address"),
        role: roleSchema.default("user"),
        /**
         * Required for a regular account — it decides everything they can see.
         * Admins are left unpinned and choose an active company instead, so a
         * companyId sent alongside role "admin" is ignored rather than refused.
         */
        companyId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();

      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "An account with that email exists" });
      }

      const companyId = input.role === "admin" ? null : input.companyId;
      if (input.role !== "admin") {
        if (!companyId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a company for this account" });
        }
        await assertCompanyExists(companyId);
      }

      const temporaryPassword = generateTempPassword();

      const created = await auth.api.createUser({
        headers: ctx.headers,
        body: {
          email,
          password: temporaryPassword,
          name: input.name,
          role: input.role,
        },
      });

      // companyId is `input: false` on the auth side — it must never come in on
      // a request body — so it is written here rather than passed to createUser.
      //
      // The two writes cannot share a transaction (the Neon HTTP driver has no
      // interactive ones), and an account that exists with no company is locked
      // out of every page. So if the second write fails, undo the first rather
      // than leaving an account only raw SQL can repair.
      if (companyId) {
        try {
          await db.update(user).set({ companyId }).where(eq(user.id, created.user.id));
        } catch (error) {
          await db.delete(user).where(eq(user.id, created.user.id));
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not assign the company — the account was not created. Try again.",
            cause: error,
          });
        }
      }

      await recordActivity({ session: ctx.session, companyId: companyId ?? ctx.companyId }, {
        action: "created",
        entityType: "user",
        entityId: created.user.id,
        entityLabel: `${input.name} · ${email}`,
        detail: input.role,
      });

      return { user: created.user, temporaryPassword };
    }),

  resetPassword: adminProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    const temporaryPassword = generateTempPassword();

    await auth.api.setUserPassword({
      headers: ctx.headers,
      body: { userId: input.userId, newPassword: temporaryPassword },
    });
    // setUserPassword does not touch additional fields, so re-arm the flag here.
    await db
      .update(user)
      .set({ mustChangePassword: true })
      .where(eq(user.id, input.userId));

    return { temporaryPassword };
  }),

  /** Moves an account to another company. Admins stay unpinned. */
  setCompany: adminProcedure
    .input(userIdSchema.extend({ companyId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await assertCompanyExists(input.companyId);
      const [target] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, input.userId));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      await db.update(user).set({ companyId: input.companyId }).where(eq(user.id, input.userId));
      return { success: true };
    }),

  setRole: adminCompanyProcedure
    .input(userIdSchema.extend({ role: roleSchema, companyId: z.string().min(1).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.role !== "admin") {
        await assertNotLastAdmin(input.userId, "demote");
      }

      // A regular account with no company resolves to "No company assigned" on
      // every request — i.e. a locked-out user. Demotion must therefore land on
      // some company: the one the account already had, an explicit choice, or —
      // for an admin, who is unpinned by definition and so has neither — the
      // company the acting admin is currently viewing. Without that last
      // fallback, demoting any admin is impossible.
      const label = await userLabel(input.userId);
      let companyId: string | null = null;
      if (input.role !== "admin") {
        companyId =
          input.companyId ?? (await auditCompanyFor(input.userId, ctx.companyId));
        await assertCompanyExists(companyId);
      }

      await auth.api.setRole({
        headers: ctx.headers,
        body: { userId: input.userId, role: input.role },
      });

      // Promoting to admin unpins the account; demoting pins it.
      await db.update(user).set({ companyId }).where(eq(user.id, input.userId));

      await recordActivity({ session: ctx.session, companyId: companyId ?? ctx.companyId }, {
        action: "role_changed",
        entityType: "user",
        entityId: input.userId,
        entityLabel: label,
        detail: input.role,
      });

      return { success: true };
    }),

  setBanned: adminCompanyProcedure
    .input(userIdSchema.extend({ banned: z.boolean(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const auditCompanyId = await auditCompanyFor(input.userId, ctx.companyId);

      if (input.banned) {
        assertNotSelf(ctx.session.user.id, input.userId, "disable");
        await assertNotLastAdmin(input.userId, "disable");

        await auth.api.banUser({
          headers: ctx.headers,
          body: { userId: input.userId, banReason: input.reason },
        });
      } else {
        await auth.api.unbanUser({
          headers: ctx.headers,
          body: { userId: input.userId },
        });
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

  deleteUser: adminCompanyProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    assertNotSelf(ctx.session.user.id, input.userId, "delete");
    await assertNotLastAdmin(input.userId, "delete");

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
