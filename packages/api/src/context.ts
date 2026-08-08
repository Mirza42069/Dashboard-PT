import { auth } from "@DashboardV2/auth";
import { TRPCError } from "@trpc/server";
import type { Context as HonoContext } from "hono";

import { resolveCompanyScopeForSession } from "./lib/scope";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({ headers });

  // Memoized, not resolved eagerly. httpBatchLink packs several procedures into
  // a single HTTP request and they all share this one context, so without the
  // cache a three-call batch resolves the same company three times — and for an
  // admin that is one or two Neon round trips apiece. Staying lazy keeps
  // company-agnostic routes (healthCheck, account.changePassword) at zero
  // queries, which is why this is not simply awaited above.
  //
  // A rejection is cached too, on purpose: the rest of the batch should fail the
  // same way without re-running the query that already failed.
  let companyScope: ReturnType<typeof resolveCompanyScopeForSession> | undefined;

  return {
    // Forwarded to auth.api.* calls so better-auth re-verifies the caller
    // server-side rather than trusting whatever the procedure passes in.
    headers,
    session,
    getCompanyId() {
      if (!session) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Authentication required",
          cause: "No session",
        });
      }
      companyScope ??= resolveCompanyScopeForSession(session.user, headers);
      return companyScope.then((scope) => scope.companyId);
    },
    getCompanyScope() {
      if (!session) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
      }
      companyScope ??= resolveCompanyScopeForSession(session.user, headers);
      return companyScope;
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
