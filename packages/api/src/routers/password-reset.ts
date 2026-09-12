import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "@DashboardV2/auth";
import { sendPasswordResetEmail } from "@DashboardV2/auth/mail";
import { TRPCError } from "@trpc/server";
import z from "zod";

import { publicProcedure, router } from "../index";

/**
 * Unauthenticated by necessity — this is the flow for people who cannot sign
 * in. Every branch of `request` answers identically so the endpoint cannot be
 * used to learn which emails have accounts; the only observable difference is
 * an email arriving or not.
 */
export const passwordResetRouter = router({
  request: publicProcedure
    .input(z.object({ email: z.email() }))
    .mutation(async ({ input }) => {
      const email = input.email.trim().toLowerCase();
      const token = await createPasswordResetToken(email);
      if (token) {
        try {
          await sendPasswordResetEmail(email, token);
        } catch (error) {
          // A delivery failure (missing API key, Resend outage) must not turn
          // into a distinguishable response — log it and keep the answer
          // generic so the user simply retries.
          console.error("Password reset email could not be sent", error);
        }
      }
      return { sent: true };
    }),

  reset: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200), newPassword: z.string().min(12).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const changed = await consumePasswordResetToken(input.token, input.newPassword);
      if (!changed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.auth.passwordResetLinkInvalid });
      }
      return { success: true };
    }),
});
