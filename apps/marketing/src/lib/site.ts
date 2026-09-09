export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fushin.ai";

/**
 * The dashboard, which is a separate Vercel deployment from this site — so its
 * URL cannot be a relative path and has to be configured rather than derived.
 * Public by design (it is used in redirects), hence NEXT_PUBLIC_.
 *
 * Set NEXT_PUBLIC_APP_URL=http://localhost:3001 to point redirects at a locally
 * running dashboard.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fushin.ai";

/** Combined landing and login destination. Trailing slashes are tolerated. */
export const LOGIN_URL = `${APP_URL.replace(/\/+$/, "")}/login`;
