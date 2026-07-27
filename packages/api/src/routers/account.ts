import { auth } from "@DashboardV2/auth";
import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { eq } from "drizzle-orm";
import z from "zod";

import { protectedProcedure, router } from "../index";

export const accountRouter = router({
  /**
   * The only path that clears `mustChangePassword`. better-auth verifies the
   * current password before accepting the new one, so a hijacked session
   * cannot silently take over the account.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: z.string().min(12, "Password must be at least 12 characters"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await auth.api.changePassword({
        headers: ctx.headers,
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        },
      });

      await db
        .update(user)
        .set({ mustChangePassword: false })
        .where(eq(user.id, ctx.session.user.id));

      return { success: true };
    }),
});
