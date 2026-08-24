export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fushin.ai";

/**
 * The dashboard, which is a separate Vercel deployment from this site — so its
 * URL cannot be a relative path and has to be configured rather than derived.
 * Public by design (it is rendered as a link), hence NEXT_PUBLIC_.
 *
 * Set NEXT_PUBLIC_APP_URL=http://localhost:3001 to point the hero at a locally
 * running dashboard.
 */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.fushin.ai";

/** Where the hero's login button goes. Trailing slashes in APP_URL are tolerated. */
export const LOGIN_URL = `${APP_URL.replace(/\/+$/, "")}/login`;

/**
 * Where demo requests reach a human.
 *
 * Used two ways: as the mailto target when Resend is not configured, and as the
 * address the server action delivers to. Public by design — it is rendered as a
 * link — so it is a NEXT_PUBLIC_ value, not a secret.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hyperferno@gmail.com";

export function isDemoConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.DEMO_TO_EMAIL && process.env.DEMO_FROM_EMAIL,
  );
}

/** Prefilled mailto used whenever the form cannot submit for real. */
export function contactMailto(subject: string) {
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
