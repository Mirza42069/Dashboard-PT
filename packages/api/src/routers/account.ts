import { auth } from "@DashboardV2/auth";
import { TRPCError } from "@trpc/server";
import z from "zod";

import { protectedProcedure, router } from "../index";

export const accountRouter = router({
  /**
   * Changes an active account's password after verifying the current one.
   * Accounts waiting for setup use the emailed one-time token instead.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string(),
        newPassword: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.currentPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.currentPasswordRequired });
      }
      if (input.newPassword.length < 12) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.passwordTooShort });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.passwordMustDiffer });
      }
      await auth.api.changePassword({
        headers: ctx.headers,
        body: {
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        },
      });

      return { success: true };
    }),
});
