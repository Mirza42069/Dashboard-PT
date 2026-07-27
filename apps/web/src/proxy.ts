import { getSessionCookie } from "better-auth/cookies";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/** Routes reachable without a session. Everything else is gated. */
const PUBLIC_PATHS = ["/login"];

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Presence check only — this is an optimistic redirect so the edge never hits
  // the database. Every protected page still resolves the real session
  // server-side via requireSession()/requireAdmin() in lib/session.ts.
  const hasSessionCookie = getSessionCookie(request) !== null;
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );

  if (isPublic) {
    if (hasSessionCookie) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${search}`);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
