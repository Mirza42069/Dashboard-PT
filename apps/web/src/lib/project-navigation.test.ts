import { describe, expect, test } from "bun:test";

import {
  isProjectTabVisible,
  projectTabPath,
  resolveBaselineStep,
  resolveProjectTab,
} from "./project-navigation";

describe("project navigation", () => {
  test("shows every configurable module by default", () => {
    for (const tab of ["tickets", "baseline", "progress", "notes"] as const) {
      expect(resolveProjectTab(tab, [], false)).toBe(tab);
    }
  });

  test("maps legacy workflow tabs to baseline and preserves their step", () => {
    expect(resolveProjectTab("boq", [], false)).toBe("baseline");
    expect(resolveBaselineStep("boq", null)).toBe("boq");
    expect(resolveProjectTab("schedule", [], false)).toBe("baseline");
    expect(resolveBaselineStep("schedule", null)).toBe("schedule");
  });

  test("resolves and builds canonical baseline navigation", () => {
    expect(resolveBaselineStep("baseline", "boq")).toBe("boq");
    expect(resolveBaselineStep("baseline", "schedule")).toBe("schedule");
    expect(resolveBaselineStep("baseline", "review")).toBe("review");
    expect(resolveBaselineStep("baseline", null)).toBe("review");
    expect(resolveBaselineStep("baseline", "invalid")).toBe("review");
    expect(projectTabPath("p1", "baseline", [], "schedule")).toBe(
      "/projects/p1?tab=baseline&step=schedule",
    );
  });

  test("hides the baseline workflow as one module", () => {
    expect(resolveProjectTab("baseline", ["baseline"], false)).toBe("overview");
    expect(resolveProjectTab("boq", ["baseline"], false)).toBe("overview");
    expect(resolveProjectTab("schedule", ["baseline"], false)).toBe("overview");
    expect(projectTabPath("p1", "baseline", ["baseline"])).toBe("/projects/p1");
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
