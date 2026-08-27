import { describe, expect, test } from "bun:test";

import { signInMethod } from "./sign-in-identifier";

describe("sign-in identifier", () => {
  test("routes email addresses to email sign-in", () => {
    expect(signInMethod("manager@example.com")).toBe("email");
  });

  test("routes usernames to username sign-in", () => {
    expect(signInMethod("site.manager")).toBe("username");
  });
});
