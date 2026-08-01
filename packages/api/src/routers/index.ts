import { protectedProcedure, publicProcedure, router } from "../index";
import { accountRouter } from "./account";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { boqRouter } from "./boq";
import { companyRouter } from "./company";
import { dailyReportRouter } from "./daily-report";
import { noteRouter } from "./note";
import { progressRouter } from "./progress";
import { projectRouter } from "./project";
import { scheduleRouter } from "./schedule";
import { ticketRouter } from "./ticket";

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
  activity: activityRouter,
  admin: adminRouter,
  company: companyRouter,
  project: projectRouter,
  ticket: ticketRouter,
  note: noteRouter,
  boq: boqRouter,
  schedule: scheduleRouter,
  progress: progressRouter,
  dailyReport: dailyReportRouter,
});
export type AppRouter = typeof appRouter;
