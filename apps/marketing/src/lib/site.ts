export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.example.com";

export function isDemoConfigured() {
  return Boolean(
    process.env.RESEND_API_KEY && process.env.DEMO_TO_EMAIL && process.env.DEMO_FROM_EMAIL,
  );
}
