import { describe, expect, test } from "bun:test";

import {
  isProjectTabVisible,
  projectTabPath,
  resolveProjectTab,
} from "./project-navigation";

describe("project navigation", () => {
  test("shows every configurable module by default", () => {
    for (const tab of ["tickets", "boq", "schedule", "baseline", "progress", "notes"] as const) {
      expect(resolveProjectTab(tab, [], false)).toBe(tab);
    }
  });

  test("hides all three baseline workflow tabs together", () => {
    for (const tab of ["boq", "schedule", "baseline"] as const) {
      expect(resolveProjectTab(tab, ["baseline"], false)).toBe("overview");
    }
  });

  test("resolves hidden and retired sections to overview", () => {
    expect(resolveProjectTab("tickets", ["actions"], false)).toBe("overview");
    expect(resolveProjectTab("progress", ["progress"], false)).toBe("overview");
    expect(resolveProjectTab("notes", ["notes"], false)).toBe("overview");
    expect(resolveProjectTab("daily", [], false)).toBe("overview");
    expect(projectTabPath("p1", "progress", ["progress"])).toBe("/projects/p1");
  });

  test("keeps team permission-derived and overview mandatory", () => {
    expect(isProjectTabVisible("overview", ["actions", "baseline", "progress", "notes"], false)).toBe(true);
    expect(resolveProjectTab("team", [], false)).toBe("overview");
    expect(resolveProjectTab("team", [], true)).toBe("team");
  });
});
