import { describe, expect, test } from "bun:test";

import { projectWorkbookFilename } from "./export-format";
import { renderProjectSCurveChart } from "./project-scurve-chart";

describe("project spreadsheet presentation", () => {
  test("names a workbook from the project name and code", () => {
    expect(projectWorkbookFilename("Harbour / Extension", "PRJ:016")).toBe(
      "Harbour _ Extension-PRJ_016.xlsx",
    );
    expect(projectWorkbookFilename("  Jalan Utama  ", "  P-17  ")).toBe(
      "Jalan Utama-P-17.xlsx",
    );
  });

  test("renders the S-curve as a valid 1200 by 600 PNG", () => {
    const png = renderProjectSCurveChart([
      { planned: 5, actual: 4, isCurrent: false },
      { planned: 30, actual: 24, isCurrent: true },
      { planned: 70, actual: null, isCurrent: false },
      { planned: 100, actual: null, isCurrent: false },
    ]);

    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1200);
    expect(view.getUint32(20)).toBe(600);
    expect(png.byteLength).toBeGreaterThan(1_000);
  });
});
