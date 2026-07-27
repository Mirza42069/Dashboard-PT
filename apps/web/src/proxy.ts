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
  matcher: [
    // App-icon conventions must be excluded by name, not by extension: Next
    // serves /apple-icon and /opengraph-image with no file extension, so the
    // extension rule below misses them and the auth gate would redirect iOS
    // and crawlers to /login instead of returning the image.
    "/((?!api|_next/static|_next/image|favicon.ico|icon|apple-icon|opengraph-image|twitter-image|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
