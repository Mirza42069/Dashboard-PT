"use client";

import { toast as sonner, type ExternalToast } from "sonner";

/**
 * Sonner, with error toasts that wait to be dismissed.
 *
 * Sonner's default is 4 seconds for everything. That is right for "Project
 * created" — the work succeeded, the toast is a receipt — and wrong for
 * "Could not save the project", where the message is the only account of what
 * went wrong and it evaporates while the user is still reading the form. The
 * sign-in path had already noticed and hardcoded `duration: 8000` for one case;
 * this generalises that rather than leaving it to whoever remembers.
 *
 * Deliberately only the two methods this app actually calls (36 `error`, 25
 * `success`) rather than a re-export of the whole surface — a wrapper that
 * forwards everything invites someone to reach past it for `toast.warning` and
 * quietly lose the behaviour. Add a method here when a call site needs one.
 *
 * Import from here rather than from "sonner" directly.
 */
export const toast = {
  /** Persists until dismissed, and carries a close button to do it with. */
  error(message: string, options?: ExternalToast) {
    return sonner.error(message, { duration: Infinity, closeButton: true, ...options });
  },

  /** Sonner's default timing — a success receipt should get out of the way. */
  success(message: string, options?: ExternalToast) {
    return sonner.success(message, options);
  },

  /**
   * Neutral notice: nothing succeeded or failed, the app is just saying
   * something. Currently the "dark mode is coming soon" reply in settings.
   * Default timing — like a success, there is nothing here to act on.
   */
  info(message: string, options?: ExternalToast) {
    return sonner.info(message, options);
  },
};
