export const SIDEBAR_COOKIE = "v2.sidebar";

/**
 * Read server-side so the collapsed sidebar renders collapsed on the very first
 * paint. Doing this from localStorage in an effect would flash the wide sidebar
 * on every navigation.
 */
export async function getSidebarCollapsed(): Promise<boolean> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
}

export function writeSidebarCookie(collapsed: boolean) {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${
    60 * 60 * 24 * 365
  }; samesite=lax`;
}
