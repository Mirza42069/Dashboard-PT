import { auth } from "@DashboardV2/auth";
import { TRPCError } from "@trpc/server";
import type { Context as HonoContext } from "hono";

import { dictionaryFor, localeFromHeaders } from "./lib/messages/index";
import { resolveCompanyIdForSession } from "./lib/scope";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({ headers });

  return createContextFromSession({ headers, session });
}

/** Server-only callers must supply the session resolved by auth for these headers. */
export function createContextFromSession({ headers, session }: {
  headers: Headers;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
}) {
  // Resolved once per request, from the same cookie apps/web writes. Every
  // throw site downstream reaches for `ctx.t` rather than plumbing a locale of
  // its own, and the Hono routes outside tRPC call localeFromHeaders directly.
  const locale = localeFromHeaders(headers);
  const t = dictionaryFor(locale);

  // Memoized, not resolved eagerly. httpBatchLink packs several procedures into
  // a single HTTP request and they all share this one context, so without the
  // cache a three-call batch resolves the same company three times — and for an
  // admin that is one or two Neon round trips apiece. Staying lazy keeps
  // company-agnostic routes (healthCheck, account.changePassword) at zero
  // queries, which is why this is not simply awaited above.
  //
  // A rejection is cached too, on purpose: the rest of the batch should fail the
  // same way without re-running the query that already failed.
  let companyId: Promise<string> | undefined;

  return {
    // Forwarded to auth.api.* calls so better-auth re-verifies the caller
    // server-side rather than trusting whatever the procedure passes in.
    headers,
    locale,
    t,
    session,
    getCompanyId() {
      if (!session) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: t.auth.required,
          cause: "No session",
        });
      }
      companyId ??= resolveCompanyIdForSession(session.user, headers);
      return companyId;
    },
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
