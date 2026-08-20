import { describe, expect, test } from "bun:test";

import {
  DEFAULT_TRIAL_AI_CREDITS,
  DEFAULT_TRIAL_DAYS,
  isTrialAccount,
  trialAiExhausted,
  trialDaysRemaining,
  trialDeadline,
  trialHasEnded,
} from "./trial";

const DAY = 86_400_000;
const now = new Date("2026-08-19T12:00:00.000Z");

describe("isTrialAccount", () => {
  test("only a set deadline makes an account a trial", () => {
    expect(isTrialAccount({ trialEndsAt: now })).toBe(true);
    expect(isTrialAccount({ trialEndsAt: null })).toBe(false);
    expect(isTrialAccount({})).toBe(false);
  });

  test("credits alone do not — the clock is what defines a trial", () => {
    expect(isTrialAccount({ trialEndsAt: null, trialAiCredits: 3 })).toBe(false);
  });
});

describe("trialHasEnded", () => {
  test("a normal account never ends", () => {
    expect(trialHasEnded({ trialEndsAt: null })).toBe(false);
    expect(trialHasEnded({})).toBe(false);
  });

  test("ended once the deadline is in the past", () => {
    expect(trialHasEnded({ trialEndsAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(trialHasEnded({ trialEndsAt: new Date(Date.now() + DAY) })).toBe(false);
  });

  test("reads an ISO string as well as a Date", () => {
    expect(trialHasEnded({ trialEndsAt: new Date(Date.now() - DAY).toISOString() })).toBe(true);
    expect(trialHasEnded({ trialEndsAt: new Date(Date.now() + DAY).toISOString() })).toBe(false);
  });
});

describe("trialDaysRemaining", () => {
  test("null for an account with no trial", () => {
    expect(trialDaysRemaining({ trialEndsAt: null })).toBeNull();
  });

  test("rounds up, so a part-day still reads as a day left", () => {
    expect(trialDaysRemaining({ trialEndsAt: new Date(Date.now() + DAY / 4) })).toBe(1);
    expect(trialDaysRemaining({ trialEndsAt: new Date(Date.now() + DAY * 6.2) })).toBe(7);
  });

  test("floors at zero rather than going negative", () => {
    expect(trialDaysRemaining({ trialEndsAt: new Date(Date.now() - DAY * 3) })).toBe(0);
  });
});

describe("trialAiExhausted", () => {
  test("a non-trial account is never out of credits", () => {
    expect(trialAiExhausted({ trialEndsAt: null, trialAiCredits: null })).toBe(false);
    expect(trialAiExhausted({ trialEndsAt: null, trialAiCredits: 0 })).toBe(false);
  });

  test("a trial with a zero or missing balance is out", () => {
    expect(trialAiExhausted({ trialEndsAt: now, trialAiCredits: 0 })).toBe(true);
    expect(trialAiExhausted({ trialEndsAt: now, trialAiCredits: null })).toBe(true);
  });

  test("credits left is not exhausted", () => {
    expect(trialAiExhausted({ trialEndsAt: now, trialAiCredits: 1 })).toBe(false);
  });

  test("the two limits are independent — spent credits do not end the trial", () => {
    const account = { trialEndsAt: new Date(Date.now() + DAY * 3), trialAiCredits: 0 };
    expect(trialAiExhausted(account)).toBe(true);
    expect(trialHasEnded(account)).toBe(false);
  });
});

describe("trialDeadline", () => {
  test("counts forward from the given instant", () => {
    expect(trialDeadline(7, now).toISOString()).toBe("2026-08-26T12:00:00.000Z");
  });

  test("the defaults produce a week and three imports", () => {
    expect(DEFAULT_TRIAL_DAYS).toBe(7);
    expect(DEFAULT_TRIAL_AI_CREDITS).toBe(3);
    expect(trialDeadline(DEFAULT_TRIAL_DAYS, now).getTime() - now.getTime()).toBe(7 * DAY);
  });

  test("a fresh deadline has not already ended", () => {
    expect(trialHasEnded({ trialEndsAt: trialDeadline(DEFAULT_TRIAL_DAYS) })).toBe(false);
  });
});
