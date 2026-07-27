import { protectedProcedure, publicProcedure, router } from "../index";
import { accountRouter } from "./account";
import { adminRouter } from "./admin";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  account: accountRouter,
  admin: adminRouter,
});
export type AppRouter = typeof appRouter;
