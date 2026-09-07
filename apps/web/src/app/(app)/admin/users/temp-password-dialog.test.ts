import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("temporary password has localized once-only sharing and manual-copy guidance", () => {
  for (const dictionary of [en, id]) {
    expect(dictionary.users.tempPasswordTitle).toContain("{name}");
    expect(dictionary.users.tempPasswordHint.length).toBeGreaterThan(50);
    expect(dictionary.users.tempPasswordCopyFailed.length).toBeGreaterThan(20);
    expect(dictionary.password.requiredDescription.length).toBeGreaterThan(20);
    expect(dictionary.users).not.toHaveProperty("setupLinkHint");
  }
});

test("dialog contract includes labeled selectable value, copy failure feedback and keyboard dismissal", () => {
  const dialog = source("./temp-password-dialog.tsx");
  expect(dialog).toContain("<Dialog open onOpenChange=");
  expect(dialog).toContain("<Label htmlFor={id}>");
  expect(dialog).toContain("id={id}");
  expect(dialog).toContain("readOnly");
  expect(dialog).toContain('autoComplete="off"');
  expect(dialog).toContain('role="status"');
  expect(dialog).toContain("event.currentTarget.select()");
  expect(dialog).toContain("navigator.clipboard.writeText(result.temporaryPassword)");
  expect(dialog).toContain("t.users.tempPasswordCopyFailed");
});

test("credential result is discarded on close and not retained in mutation caches or browser storage", () => {
  const table = source("./users-table.tsx");
  const create = source("./create-user-dialog.tsx");
  expect(table).toContain("onDismiss={() => setTemporaryPassword(null)}");
  for (const text of [table, create]) {
    expect(text).toContain("gcTime: 0");
    expect(text).toContain(".reset()");
    expect(text).not.toMatch(/localStorage|sessionStorage|console\./);
  }
});
