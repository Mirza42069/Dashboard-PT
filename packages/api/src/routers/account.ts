import { changeOwnPassword } from "@DashboardV2/auth";
import { Effect } from "effect";
import z from "zod";

import { authenticatedProcedure, router } from "../index";
import { attempt, fail, runProcedure } from "../lib/effect";

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
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          if (!input.currentPassword) {
            return yield* fail("BAD_REQUEST", ctx.t.user.currentPasswordRequired);
          }
          if (input.newPassword.length < 12) {
            return yield* fail("BAD_REQUEST", ctx.t.user.passwordTooShort);
          }
          if (input.currentPassword.normalize("NFKC") === input.newPassword.normalize("NFKC")) {
            return yield* fail("BAD_REQUEST", ctx.t.user.passwordMustDiffer);
          }
          const changed = yield* attempt(() =>
            changeOwnPassword(ctx.session.user.id, ctx.session.session.id, input.currentPassword, input.newPassword),
          );
          if (!changed) {
            return yield* fail("BAD_REQUEST", ctx.t.user.passwordChangeFailed);
          }

          return { success: true };
        }),
      ),
    ),
});
