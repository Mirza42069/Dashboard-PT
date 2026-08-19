export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";

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
