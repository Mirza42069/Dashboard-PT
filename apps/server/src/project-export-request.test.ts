import { describe, expect, test } from "bun:test";

import {
  MAX_SELECTED_PROJECT_EXPORTS,
  ProjectExportRequestError,
  parseProjectExportRequest,
} from "./project-export-request";

describe("selected project export request", () => {
  test("accepts one through one hundred unique project IDs", () => {
    const projectIds = Array.from({ length: MAX_SELECTED_PROJECT_EXPORTS }, (_, index) => `p-${index}`);
    expect(parseProjectExportRequest({ projectIds, locale: "id" })).toEqual({
      projectIds,
      locale: "id",
    });
  });

  test("accepts an optional daily report date and omits it when absent", () => {
    expect(parseProjectExportRequest({ projectIds: ["p-1"], dailyReportDate: "2026-08-22" })).toEqual({
      projectIds: ["p-1"],
      dailyReportDate: "2026-08-22",
    });
    expect(parseProjectExportRequest({ projectIds: ["p-1"] })).toEqual({ projectIds: ["p-1"] });
  });

  test.each([
    null,
    {},
    { projectIds: [] },
    { projectIds: [""] },
    { projectIds: ["p-1", "p-1"] },
    { projectIds: Array.from({ length: MAX_SELECTED_PROJECT_EXPORTS + 1 }, (_, index) => `p-${index}`) },
    { projectIds: ["p-1"], locale: "fr" },
    { projectIds: ["p-1"], dailyReportDate: "08/22/2026" },
    { projectIds: ["p-1"], dailyReportDate: "2026-13-01" },
  ])("rejects invalid input %#", (input) => {
    expect(() => parseProjectExportRequest(input)).toThrow(ProjectExportRequestError);
  });
});
