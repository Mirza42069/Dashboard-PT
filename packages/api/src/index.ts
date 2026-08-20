import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";
import { hasPermission, roleOf, type Permission } from "./lib/permissions";
import { trialHasEnded } from "./lib/trial";

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
  // A trial that lapsed mid-session still holds a valid cookie — packages/auth
  // only refuses to *create* a session for one. Every procedure fails closed
  // here so the page-level redirect in apps/web is a courtesy, not the control.
  if (trialHasEnded(ctx.session.user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This trial has ended",
      cause: "Trial ended",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
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

function assertPermission(permission: Permission, user: { role?: string | null }) {
  if (!hasPermission(roleOf(user), permission)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Insufficient role",
      cause: "Missing permission",
    });
  }
}

/**
 * The permission a request needs is declared once, at the call site — see
 * packages/api/src/lib/permissions.ts for the role→permission map this checks
 * against. Cross-tenant ops (company CRUD, global user listing) use this;
 * anything reading or writing tenant data uses companyPermissionProcedure
 * instead, below.
 */
export const permissionProcedure = (permission: Permission) =>
  protectedProcedure.use(({ ctx, next }) => {
    assertPermission(permission, ctx.session.user);
    return next({ ctx });
  });

/** Permission check + ctx.companyId — the workhorse for tenant-scoped data. */
export const companyPermissionProcedure = (permission: Permission) =>
  companyProcedure.use(({ ctx, next }) => {
    assertPermission(permission, ctx.session.user);
    return next({ ctx });
  });
