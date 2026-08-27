import { describe, expect, test } from "bun:test";

import {
  isValidAccountName,
  normalizeAccountName,
  normalizeUsername,
  usernameFromName,
} from "./username";

describe("username credentials", () => {
  test("normalizes usernames for case-insensitive sign-in", () => {
    expect(normalizeUsername("  Rama Putra ")).toBe("rama putra");
    expect(normalizeAccountName("  Rama   Putra ")).toBe("Rama Putra");
  });

  test("accepts human names but rejects ambiguous or unsafe identifiers", () => {
    expect(isValidAccountName("Rama Putra")).toBe(true);
    expect(isValidAccountName("Dewi's Team-2")).toBe(true);
    expect(isValidAccountName("admin@example.com")).toBe(false);
    expect(isValidAccountName("line\nbreak")).toBe(false);
    expect(isValidAccountName("\tRama Putra")).toBe(false);
    expect(isValidAccountName("Rama\u200bPutra")).toBe(false);
    expect(isValidAccountName("İpek")).toBe(false);
    expect(isValidAccountName("a".repeat(121))).toBe(false);
  });

  test("uses the normalized account name as the username", () => {
    expect(usernameFromName("Rama Putra")).toBe("rama putra");
  });
});
