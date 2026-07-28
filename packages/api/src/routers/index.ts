import { protectedProcedure, publicProcedure, router } from "../index";
import { accountRouter } from "./account";
import { activityRouter } from "./activity";
import { adminRouter } from "./admin";
import { boqRouter } from "./boq";
import { equipmentRouter } from "./equipment";
import { expenseRouter } from "./expense";
import { materialRouter } from "./material";
import { noteRouter } from "./note";
import { progressRouter } from "./progress";
import { projectRouter } from "./project";
import { scheduleRouter } from "./schedule";
import { taskRouter } from "./task";

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
  project: projectRouter,
  task: taskRouter,
  material: materialRouter,
  equipment: equipmentRouter,
  expense: expenseRouter,
  note: noteRouter,
  boq: boqRouter,
  schedule: scheduleRouter,
  progress: progressRouter,
});
export type AppRouter = typeof appRouter;
