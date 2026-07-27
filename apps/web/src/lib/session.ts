import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { authClient } from "./auth-client";

/**
 * Resolves the real session against the API. middleware.ts only checks that a
 * cookie exists, so this is the authoritative check — every protected page must
 * call one of the helpers below rather than trusting the redirect at the edge.
 */
export async function getSession() {
  try {
    return await authClient.getSession({
      fetchOptions: {
        headers: await headers(),
        throw: true,
      },
    });
  } catch {
    // A revoked, expired or banned session resolves to "not signed in".
    return null;
  }
}

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

export async function requireAdmin() {
  const session = await requireSession();

  if (session.user.role !== "admin") {
    redirect("/dashboard");
  }

  return session;
}
