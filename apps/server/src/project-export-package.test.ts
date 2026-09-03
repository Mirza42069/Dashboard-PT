import { describe, expect, test } from "bun:test";
import { strFromU8, strToU8, unzipSync } from "fflate";

import { packageProjectWorkbooks } from "./project-export-package";

describe("selected project export packaging", () => {
  test("returns one workbook directly", () => {
    const body = Uint8Array.from([1, 2, 3]);
    const result = packageProjectWorkbooks([{ filename: "PRJ-1.xlsx", body }], "2026-09-02");

    expect(result.filename).toBe("PRJ-1.xlsx");
    expect(result.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.body).toBe(body);
  });

  test("returns one named workbook per project in a zip", () => {
    const result = packageProjectWorkbooks(
      [
        { filename: "PRJ-1.xlsx", body: Uint8Array.from(strToU8("one")) },
        { filename: "PRJ-2.xlsx", body: Uint8Array.from(strToU8("two")) },
      ],
      "2026-09-02",
    );

    expect(result.filename).toBe("projects-2026-09-02.zip");
    expect(result.contentType).toBe("application/zip");
    const files = unzipSync(result.body);
    expect(Object.keys(files).sort()).toEqual(["PRJ-1.xlsx", "PRJ-2.xlsx"]);
    expect(strFromU8(files["PRJ-1.xlsx"]!)).toBe("one");
    expect(strFromU8(files["PRJ-2.xlsx"]!)).toBe("two");
  });
});
