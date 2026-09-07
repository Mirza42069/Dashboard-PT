import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("trial expiry precedes the pending-password redirect and trial-ended bypasses both gates", () => {
  const session = readFileSync(new URL("./session.ts", import.meta.url), "utf8");
  const trialPage = readFileSync(new URL("../app/trial-ended/page.tsx", import.meta.url), "utf8");
  const passwordPage = readFileSync(new URL("../app/change-password/page.tsx", import.meta.url), "utf8");
  expect(session.indexOf('redirect("/trial-ended")')).toBeLessThan(session.indexOf('redirect("/change-password")'));
  expect(trialPage).toContain("skipTrialEndedRedirect: true, skipPasswordChangeRedirect: true");
  expect(passwordPage).toContain("skipPasswordChangeRedirect: true");
  expect(passwordPage).not.toContain("skipTrialEndedRedirect: true");
});
