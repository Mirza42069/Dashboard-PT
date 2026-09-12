import { publicProcedure, router } from "../index";
import { accountRouter } from "./account";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { boqRouter } from "./boq";
import { companyRouter } from "./company";
import { dailyProgressRouter } from "./daily-progress";
import { noteRouter } from "./note";
import { passwordResetRouter } from "./password-reset";
import { progressRouter } from "./progress";
import { projectRouter } from "./project";
import { scheduleRouter } from "./schedule";
import { supportRouter } from "./support";
import { ticketRouter } from "./ticket";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
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
  dailyProgress: dailyProgressRouter,
  passwordReset: passwordResetRouter,
  support: supportRouter,
});
export type AppRouter = typeof appRouter;
