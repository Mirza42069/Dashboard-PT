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

  // Public pages always render. Bouncing signed-in users away from /login is
  // done by the page itself, which resolves the *real* session — doing it here
  // on cookie presence alone deadlocks: a cookie that no longer resolves sends
  // /login -> /dashboard -> requireSession() -> /login, and the browser gives up
  // with ERR_TOO_MANY_REDIRECTS. That state is unrecoverable from the UI,
  // because the one page that could fix it is the one you can never reach.
  if (isPublic) {
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
  matcher: [
    // App-icon conventions must be excluded by name, not by extension: Next
    // serves /apple-icon and /opengraph-image with no file extension, so the
    // extension rule below misses them and the auth gate would redirect iOS
    // and crawlers to /login instead of returning the image.
    "/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
