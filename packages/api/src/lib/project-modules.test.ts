import { describe, expect, test } from "bun:test";

import {
  PROJECT_MODULE_KEYS,
  isProjectModuleKey,
  normalizeHiddenProjectModules,
} from "./project-modules";

describe("project modules", () => {
  test("keeps a stable set of configurable modules", () => {
    expect(PROJECT_MODULE_KEYS).toEqual(["actions", "baseline", "progress", "notes"]);
    expect(isProjectModuleKey("baseline")).toBe(true);
    expect(isProjectModuleKey("boq")).toBe(false);
  });

  test("normalizes unknown, duplicate and unordered stored values", () => {
    expect(normalizeHiddenProjectModules(["notes", "unknown", "actions", "notes"])).toEqual([
      "actions",
      "notes",
    ]);
  });

  test("defaults to showing every module", () => {
    expect(normalizeHiddenProjectModules([])).toEqual([]);
  });
});
