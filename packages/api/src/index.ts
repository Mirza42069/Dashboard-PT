import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
      cause: "Insufficient role",
    });
  }
  return next({ ctx });
});

/**
 * Adds the active company to the context.
 *
 * Pulled from the context lazily rather than resolved in createContext, so that
 * unauthenticated and company-agnostic routes (healthCheck,
 * account.changePassword) cost no queries. ctx.getCompanyId memoizes for the
 * life of the request, so a batched call resolves it once no matter how many
 * procedures ask.
 *
 * Anything reading or writing tenant data must use this instead of
 * protectedProcedure — `ctx.companyId` exists only on these procedures, so the
 * type checker flags a router that forgot to scope itself.
 */
export const companyProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const companyId = await ctx.getCompanyId();
  return next({ ctx: { ...ctx, companyId } });
});

export const adminCompanyProcedure = companyProcedure.use(({ ctx, next }) => {
  if (ctx.session.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
      cause: "Insufficient role",
    });
  }
  return next({ ctx });
});
