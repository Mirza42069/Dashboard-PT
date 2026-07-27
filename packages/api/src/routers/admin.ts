import { auth } from "@DashboardV2/auth";
import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { TRPCError } from "@trpc/server";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import z from "zod";

import { adminProcedure, router } from "../index";

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

function assertNotSelf(actorId: string, targetId: string, action: string) {
  if (actorId === targetId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `You cannot ${action} your own account` });
  }
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
          })
          .from(user)
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
  createUser: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1, "Name is required").max(120),
        email: z.email("Invalid email address"),
        role: roleSchema.default("user"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();

      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "An account with that email exists" });
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

  setRole: adminProcedure
    .input(userIdSchema.extend({ role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.role !== "admin") {
        await assertNotLastAdmin(input.userId, "demote");
      }

      await auth.api.setRole({
        headers: ctx.headers,
        body: { userId: input.userId, role: input.role },
      });

      return { success: true };
    }),

  setBanned: adminProcedure
    .input(userIdSchema.extend({ banned: z.boolean(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
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

      return { success: true };
    }),

  deleteUser: adminProcedure.input(userIdSchema).mutation(async ({ ctx, input }) => {
    assertNotSelf(ctx.session.user.id, input.userId, "delete");
    await assertNotLastAdmin(input.userId, "delete");

    await auth.api.removeUser({
      headers: ctx.headers,
      body: { userId: input.userId },
    });

    return { success: true };
  }),
});
