import { changeOwnPassword } from "@DashboardV2/auth";
import { TRPCError } from "@trpc/server";
import z from "zod";

import { authenticatedProcedure, router } from "../index";

export const accountRouter = router({
  /**
   * The only pending-session mutation. The target is always the session owner,
   * and password verification, unlocking and revocation form one atomic change.
   */
  changePassword: authenticatedProcedure
    .input(
      z.object({
        currentPassword: z.string().max(128),
        newPassword: z.string().max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.currentPassword) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.currentPasswordRequired });
      }
      if (input.newPassword.length < 12) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.passwordTooShort });
      }
      if (input.currentPassword.normalize("NFKC") === input.newPassword.normalize("NFKC")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.passwordMustDiffer });
      }
      if (!await changeOwnPassword(ctx.session.user.id, ctx.session.session.id, input.currentPassword, input.newPassword)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.user.passwordChangeFailed });
      }

      return { success: true };
    }),
});
