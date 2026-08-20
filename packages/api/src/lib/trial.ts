/**
 * Trial-account rules, in one place, with no imports.
 *
 * Kept dependency-free for the same reason as ./permissions.ts: apps/web
 * imports this from both server components and the browser bundle, so anything
 * pulled in here — db, env, auth — would leak into the client. Never add an
 * import to this file without checking that constraint first.
 *
 * A trial has two limits that run out independently. The clock is the one that
 * ends the account; the AI allowance only closes one door. Neither is a stored
 * "expired" flag, because a flag needs something to set it and this product has
 * no background worker — a comparison against now() is correct at every instant
 * without one.
 */

/** What a trial account starts with when an admin does not say otherwise. */
export const DEFAULT_TRIAL_DAYS = 7;
export const DEFAULT_TRIAL_AI_CREDITS = 3;

/** The bounds an admin may set, so a typo cannot mint a decade-long trial. */
export const MAX_TRIAL_DAYS = 365;
export const MAX_TRIAL_AI_CREDITS = 100;

/**
 * The error code a sign-in attempt carries when the trial is over.
 *
 * Lives here rather than in packages/auth because the sign-in form is a client
 * component: importing the auth package would pull db and env into the browser
 * bundle. packages/auth mirrors the literal — same arrangement as COMPANY_COOKIE
 * in ./scope.ts.
 */
export const TRIAL_ENDED_CODE = "TRIAL_ENDED";

/**
 * What the import route returns when a trial has spent its AI allowance.
 *
 * A code rather than a matched message, so the dialog can offer the manual
 * import instead of showing a generic failure — the account is not broken and
 * nothing else about it has changed.
 */
export const TRIAL_AI_EXHAUSTED = "TRIAL_AI_EXHAUSTED";

export type TrialFields = {
  trialEndsAt?: Date | string | null;
  trialAiCredits?: number | null;
};

/** True for an account an admin put on a trial, whether or not it has lapsed. */
export function isTrialAccount(user: TrialFields): boolean {
  return user.trialEndsAt !== null && user.trialEndsAt !== undefined;
}

/**
 * True once the clock has run out.
 *
 * Non-trial accounts are never ended — a null `trialEndsAt` means the limits
 * do not apply at all, not that they expired at the epoch.
 */
export function trialHasEnded(user: TrialFields): boolean {
  if (!user.trialEndsAt) return false;
  return new Date(user.trialEndsAt).getTime() <= Date.now();
}

/**
 * Whole days left, rounded up, floored at zero.
 *
 * Rounded up because "1 day left" should still say so with four hours on the
 * clock — rounding down would show a trial as having zero days left for its
 * entire final day, which reads as ended when it is not.
 */
export function trialDaysRemaining(user: TrialFields): number | null {
  if (!user.trialEndsAt) return null;
  const ms = new Date(user.trialEndsAt).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** True when the account is on a trial and has spent its AI allowance. */
export function trialAiExhausted(user: TrialFields): boolean {
  return isTrialAccount(user) && (user.trialAiCredits ?? 0) <= 0;
}

/** A deadline `days` from now, for starting or extending a trial. */
export function trialDeadline(days: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + days * 86_400_000);
}
