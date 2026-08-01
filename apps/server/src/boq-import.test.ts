import { expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { resolve } from "node:path";

import { columnLetter, parseNumber, parseRows, readCell, errorReportCsv } from "./boq-import-parse";

/**
 * The importer, against the workbook it was written for.
 *
 * `reference/S-CURVE PLAN VS ACTUAL RSCH.xlsx` is a real contractor's schedule,
 * and it is a useful fixture precisely because it is *awkward*: its column names
 * do not start until row 7, almost every cell in its grid is a shared formula
 * rather than a value, and its NO column is a sparse set of roman numerals that
 * names sections rather than identifying lines.
 *
 * The last of those is why the headline case below asserts a **failure**. Mapped
 * as BoQ codes, that column leaves most rows without one — and the right
 * outcome is a list of numbered rows to go and fix, not a partial import that
 * quietly invents identities for two thirds of the bill.
 */

// From apps/server/src up to the repo root. Resolved rather than passed as a
// URL because the filename has a space in it, and a file: URL percent-encodes
// it into a path exceljs then cannot find.
const REFERENCE = resolve(import.meta.dir, "../../../reference/S-CURVE PLAN VS ACTUAL RSCH.xlsx");
const HEADER_ROW = 7;

const periods = Array.from({ length: 17 }, (_, index) => ({
  periodIndex: index + 1,
  startDate: `2026-05-${String(2 + index * 7).padStart(2, "0")}`,
  endDate: `2026-05-${String(8 + index * 7).padStart(2, "0")}`,
}));

async function referenceSheet() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(REFERENCE);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The reference workbook has no sheets");
  return sheet;
}

/* --------------------------------------------------------------- cell reading */

test("a shared-formula cell is read from its cached result", () => {
  expect(readCell({ sharedFormula: "J13", result: 0.3947 })).toEqual({
    kind: "number",
    value: 0.3947,
  });
});

test("a formula with no cached result is empty, never zero", () => {
  // An unevaluated cell is unknown. Reading it as 0 is how an import silently
  // prices a line at nothing.
  expect(readCell({ formula: "SUM(J13:J34)" })).toEqual({ kind: "empty" });
});

test("an error cell is reported rather than coerced", () => {
  expect(readCell({ error: "#REF!" })).toEqual({ kind: "error", value: "#REF!" });
});

test("rich text and hyperlink cells read as their text", () => {
  expect(readCell({ richText: [{ text: "URAIAN " }, { text: "PEKERJAAN" }] })).toEqual({
    kind: "string",
    value: "URAIAN PEKERJAAN",
  });
  expect(readCell({ text: "  ", hyperlink: "x" })).toEqual({ kind: "empty" });
});

/* -------------------------------------------------------------------- numbers */

test("blank is null, not zero", () => {
  expect(parseNumber({ kind: "empty" })).toBeNull();
  expect(parseNumber({ kind: "string", value: "   " })).toBeNull();
});

test("both separator conventions parse", () => {
  // Both marks present: the later one is the decimal point.
  expect(parseNumber({ kind: "string", value: "1.234,56" })).toBe(1234.56);
  expect(parseNumber({ kind: "string", value: "1,234.56" })).toBe(1234.56);
  // Repeated mark: grouping, whichever mark it is. This is how the reference
  // workbook writes its contract sums.
  expect(parseNumber({ kind: "string", value: "Rp 150.508.306" })).toBe(150508306);
  expect(parseNumber({ kind: "string", value: "2,542,143,270" })).toBe(2542143270);
  // A lone separator is a decimal point — genuinely ambiguous, and settled this
  // way rather than by guessing at digit grouping.
  expect(parseNumber({ kind: "string", value: "1.5" })).toBe(1.5);
  expect(parseNumber({ kind: "string", value: "1,5" })).toBe(1.5);
});

test("anything that is not a number is rejected rather than coerced", () => {
  for (const value of ["n/a", "-", "TBC", "12 m3", "#DIV/0!"]) {
    expect(parseNumber({ kind: "string", value })).toBe("invalid");
  }
});

test("column letters follow the spreadsheet's own naming", () => {
  expect([1, 2, 26, 27, 28].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB"]);
});

/* ----------------------------------------------------- the reference workbook */

test("the reference sheet's description column reads as real text", async () => {
  const sheet = await referenceSheet();
  const { rows } = parseRows(
    sheet,
    HEADER_ROW,
    // C = URAIAN PEKERJAAN, E = BOBOT, F = MINGGU (start), G = MINGGU (finish).
    { fields: { description: 3 } },
    periods,
  );

  const descriptions = rows.map((row) => row.description);
  expect(descriptions).toContain("PRELIMINARIES");
  expect(descriptions).toContain("DEMOLISH WORK");
  // Its summary block at the foot of the sheet is text in the same column, so a
  // real import of this file needs those rows trimmed. Worth knowing.
  expect(descriptions).toContain("TOTAL");
});

test("mapping the sparse NO column as codes fails the import rather than half-doing it", async () => {
  const sheet = await referenceSheet();
  const { errors } = parseRows(
    sheet,
    HEADER_ROW,
    { fields: { code: 2, description: 3 } },
    periods,
  );

  const missingCode = errors.filter((error) => error.message === "BoQ code is required.");
  expect(missingCode.length).toBeGreaterThan(5);
  // Row numbers are the sheet's own, so they can be found in the open file.
  expect(missingCode.every((error) => error.row > HEADER_ROW)).toBe(true);
  expect(missingCode[0]?.column).toBe("B");
});

test("without a code column the lines are numbered in sheet order", async () => {
  const sheet = await referenceSheet();
  const { rows, errors } = parseRows(sheet, HEADER_ROW, { fields: { description: 3 } }, periods);

  expect(errors).toEqual([]);
  expect(rows.map((row) => row.code)).toEqual(rows.map((_, index) => String(index + 1)));
});

test("the workbook's MINGGU columns import as a planning window", async () => {
  const sheet = await referenceSheet();
  const { rows } = parseRows(
    sheet,
    HEADER_ROW,
    { fields: { description: 3, weight: 5, start: 6, finish: 7 } },
    periods,
  );

  // Row 13, PRELIMINARIES: weeks 3 to 17, weight 5.92 — straight off the sheet.
  const preliminaries = rows.find((row) => row.description === "PRELIMINARIES");
  expect(preliminaries?.start).toBe(3);
  expect(preliminaries?.finish).toBe(17);
  expect(preliminaries?.weight).toBeCloseTo(5.920528, 4);
});

/* ------------------------------------------------------------ synthetic faults */

async function sheetFrom(rows: (string | number | null)[][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Test");
  sheet.addRow(["Code", "Description", "Section", "Quantity", "Rate", "Start", "Finish"]);
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

const FULL = {
  fields: { code: 1, description: 2, parent: 3, quantity: 4, unitRate: 5, start: 6, finish: 7 },
};

test("a duplicate code under the same section is reported with the row it clashes with", async () => {
  const sheet = await sheetFrom([
    ["1", "Groundworks", null, null, null, null, null],
    ["1.1", "Excavation", "1", 10, 100, 1, 2],
    ["1.1", "Backfill", "1", 5, 200, 1, 2],
  ]);
  const { errors } = parseRows(sheet, 1, FULL, periods);

  expect(errors).toHaveLength(1);
  expect(errors[0]?.row).toBe(4);
  expect(errors[0]?.message).toContain("already used on row 3");
});

test("the same code under different sections is fine", async () => {
  const sheet = await sheetFrom([
    ["1", "Groundworks", null, null, null, null, null],
    ["2", "Structure", null, null, null, null, null],
    ["1.1", "Excavation", "1", 10, 100, 1, 2],
    ["1.1", "Columns", "2", 5, 200, 1, 2],
  ]);
  expect(parseRows(sheet, 1, FULL, periods).errors).toEqual([]);
});

test("a line pointing at a section that is not in the sheet is a broken hierarchy", async () => {
  const sheet = await sheetFrom([["1.1", "Excavation", "9", 10, 100, 1, 2]]);
  const { errors } = parseRows(sheet, 1, FULL, periods);

  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toContain('No section with code "9"');
});

test("a line naming itself as its own section is rejected", async () => {
  const sheet = await sheetFrom([["1", "Groundworks", "1", 10, 100, 1, 2]]);
  const { errors } = parseRows(sheet, 1, FULL, periods);
  expect(errors[0]?.message).toContain("cannot be its own section");
});

test("a non-numeric quantity is a row error, not a zero", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, "TBC", 100, 1, 2]]);
  const { rows, errors } = parseRows(sheet, 1, FULL, periods);

  expect(rows).toHaveLength(0);
  expect(errors[0]).toMatchObject({ row: 2, column: "D", message: "Quantity must be a number." });
});

test("a negative rate is refused", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, 10, -5, 1, 2]]);
  expect(parseRows(sheet, 1, FULL, periods).errors[0]?.message).toBe("Unit rate cannot be negative.");
});

test("a finish before the start is refused", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, 10, 100, 9, 4]]);
  expect(parseRows(sheet, 1, FULL, periods).errors[0]?.message).toContain(
    "finish period cannot come before",
  );
});

test("half a planning window is refused", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, 10, 100, 3, null]]);
  expect(parseRows(sheet, 1, FULL, periods).errors[0]?.message).toContain(
    "both a start and a finish",
  );
});

test("a period number the project does not have names the range it does", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, 10, 100, 1, 99]]);
  expect(parseRows(sheet, 1, FULL, periods).errors[0]?.message).toContain("periods 1 to 17");
});

test("blank spacer rows are skipped, but a row with a code and no description is not", async () => {
  const sheet = await sheetFrom([
    ["1", "Excavation", null, 10, 100, 1, 2],
    [null, null, null, null, null, null, null],
    ["2", null, null, 10, 100, 1, 2],
  ]);
  const { rows, errors } = parseRows(sheet, 1, FULL, periods);

  expect(rows).toHaveLength(1);
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ row: 4, message: "Description is required." });
});

test("explicit period columns must total 100 across the row", async () => {
  const sheet = await sheetFrom([["1", "Excavation", null, 10, 100, null, null]]);
  sheet.getRow(2).getCell(8).value = 40;
  sheet.getRow(2).getCell(9).value = 40;

  const mapping = {
    fields: { code: 1, description: 2 },
    periodColumns: [
      { periodIndex: 1, column: 8 },
      { periodIndex: 2, column: 9 },
    ],
  };
  const { errors } = parseRows(sheet, 1, mapping, periods);
  expect(errors[0]?.message).toContain("total 80.00%");

  sheet.getRow(2).getCell(9).value = 60;
  expect(parseRows(sheet, 1, mapping, periods).errors).toEqual([]);
});

/* ------------------------------------------------------------- error report */

test("the error report escapes quotes and keeps the row numbers", () => {
  const csv = errorReportCsv([
    { row: 12, column: "B", message: 'Code "1.1" is already used on row 9.' },
    { row: 14, column: null, message: "Description is required." },
  ]);

  expect(csv).toContain("Row,Column,Problem");
  expect(csv).toContain('12,"B","Code ""1.1"" is already used on row 9."');
  expect(csv).toContain('14,"","Description is required."');
});
