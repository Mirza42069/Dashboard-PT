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

  test.each([
    null,
    {},
    { projectIds: [] },
    { projectIds: [""] },
    { projectIds: ["p-1", "p-1"] },
    { projectIds: Array.from({ length: MAX_SELECTED_PROJECT_EXPORTS + 1 }, (_, index) => `p-${index}`) },
    { projectIds: ["p-1"], locale: "fr" },
  ])("rejects invalid input %#", (input) => {
    expect(() => parseProjectExportRequest(input)).toThrow(ProjectExportRequestError);
  });
});
