import { describe, expect, test } from "bun:test";

import { isValidUsername, normalizeUsername, usernameFromEmail } from "./username";

describe("username credentials", () => {
  test("normalizes usernames for case-insensitive sign-in", () => {
    expect(normalizeUsername("  Site.Manager_1 ")).toBe("site.manager_1");
  });

  test("accepts only supported username characters and lengths", () => {
    expect(isValidUsername("site.manager_1")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("site-manager")).toBe(false);
    expect(isValidUsername("a".repeat(31))).toBe(false);
  });

  test("derives a valid initial username from an email address", () => {
    expect(usernameFromEmail("Mirza+Ops@example.com")).toBe("mirza_ops");
    expect(usernameFromEmail("x@example.com")).toBe("user_x");
  });
});
