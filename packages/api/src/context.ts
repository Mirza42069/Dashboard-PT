import { auth } from "@DashboardV2/auth";
import type { Context as HonoContext } from "hono";

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const headers = context.req.raw.headers;
  const session = await auth.api.getSession({ headers });
  return {
    // Forwarded to auth.api.* calls so better-auth re-verifies the caller
    // server-side rather than trusting whatever the procedure passes in.
    headers,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
