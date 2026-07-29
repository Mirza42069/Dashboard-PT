import { hasPermission, type Permission, roleOf } from "@DashboardV2/api/lib/permissions";
import { auth } from "@DashboardV2/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

/**
 * Resolves the real session. proxy.ts only checks that a cookie exists, so this
 * is the authoritative check — every protected page must call one of the
 * helpers below rather than trusting the redirect at the edge.
 *
 * Resolved in-process rather than over HTTPS to the API service. Production
 * logs put better-auth's own get-session handler at 1-2ms while the round trip
 * wrapping it cost two orders of magnitude more, and it ran ahead of the HTML
 * on every protected render — so the hop was almost pure waiting. Going direct
 * costs the web service its own DATABASE_URL and BETTER_AUTH_SECRET; see the
 * README's deployment notes.
 *
 * `next/headers` is what keeps this module server-only: a client component that
 * imports it fails the build, so @DashboardV2/auth and the database behind it
 * can never reach the browser bundle. Sign-in and sign-out still go through
 * lib/auth-client.ts over HTTP, as they have to.
 *
 * cache() dedupes for the life of one render. A protected route resolves the
 * session at least twice — once in (app)/layout.tsx and again in the page — so
 * without this the layout/page pair costs double for one answer.
 */
export const getSession = cache(async () => {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch {
    // A revoked, expired or banned session resolves to "not signed in".
    return null;
  }
});

type RequireSessionOptions = {
  /** Set on /change-password itself, which would otherwise redirect to itself. */
  skipPasswordChangeRedirect?: boolean;
};

export async function requireSession(options: RequireSessionOptions = {}) {
  const session = await getSession();

  if (!session?.user) {
    redirect("/login");
  }

  if (!options.skipPasswordChangeRedirect && session.user.mustChangePassword) {
    redirect("/change-password");
  }

  return session;
}

/** Redirects home unless the signed-in account holds `permission`. */
export async function requirePermission(permission: Permission) {
  const session = await requireSession();

  if (!hasPermission(roleOf(session.user), permission)) {
    redirect("/dashboard");
  }

  return session;
}
