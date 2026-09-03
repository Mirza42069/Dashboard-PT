import { expect, setDefaultTimeout, test } from "bun:test";
import ExcelJS from "exceljs";
import { resolve } from "node:path";

import { loadWorkbook } from "./boq-import-parse";
import { parseDailyProgressWorkbook } from "./project-daily-progress";
import {
  addDailyReportSheet,
  overlayDailyCurveReadings,
  type DailyReportItem,
} from "./project-daily-report-export";

setDefaultTimeout(60_000);

const REFERENCE = resolve(import.meta.dir, "../../../reference/DAILY PROGRESS WEEK 16.xlsx");

function reportItems(items: Awaited<ReturnType<typeof parsedItems>>): DailyReportItem[] {
  return items.map(({ sourceValues: _sourceValues, ...item }) => item);
}

async function parsedItems() {
  const bytes = new Uint8Array(await Bun.file(REFERENCE).arrayBuffer());
  const parsed = parseDailyProgressWorkbook(await loadWorkbook(bytes));
  if (!parsed || parsed.errors.length > 0) throw new Error("reference fixture must parse");
  return parsed.snapshots.at(-1)!.items;
}

test("the daily report sheet replicates the contractor layout with signatures", async () => {
  const snapshotItems = await parsedItems();
  const workbook = new ExcelJS.Workbook();
  addDailyReportSheet(workbook, {
    sheetName: "Laporan Harian",
    projectName: "PEKERJAAN STRUCTURE RSU CITRA HARAPAN",
    projectCode: "PRJ-016",
    client: "Client",
    location: "Batam",
    periodLabel: "Minggu 16",
    snapshot: { reportDate: "2026-08-22", cumulativePercent: 56.9230209578 },
    items: reportItems(snapshotItems),
  });
  const sheet = workbook.getWorksheet("Laporan Harian");
  if (!sheet) throw new Error("report sheet missing");

  expect(String(sheet.getCell("A1").value)).toContain("MONITORING PROGRESS");
  expect(String(sheet.getCell("A1").value)).toContain("PEKERJAAN STRUCTURE RSU CITRA HARAPAN");
  expect(String(sheet.getCell("A3").value)).toContain("Tanggal laporan: 2026-08-22");

  // The two-row merged header, matching the original workbook.
  expect(sheet.getCell("B5").value).toBe("URAIAN PEKERJAAN");
  expect(sheet.getCell("H5").value).toBe("PROGRESS MINGGU LALU");
  expect(sheet.getCell("H6").value).toBe("PERSENTASE");
  expect(sheet.getCell("I6").value).toBe("BOBOT");
  expect(sheet.getCell("L5").value).toBe("PROGRESS S/D MINGGU INI");

  // A section banner and the first priced line under it.
  expect(sheet.getCell("A7").value).toContain("BILL");
  const firstItemRow = sheet.getRow(8);
  expect(firstItemRow.getCell(3).value).toBe(24);

  // The grand total reconciles with the parsed weighted cumulative progress.
  const totalRow = sheet.getRow(sheet.rowCount - 8);
  expect(totalRow.getCell(1).value).toBe("GRAND TOTAL");
  const cumulativeCell = totalRow.getCell(13);
  expect(cumulativeCell.value).toBeCloseTo(0.569230209578, 8);
  expect(cumulativeCell.numFmt).toBe("0.00%");

  // The three-party signature block, always in Indonesian.
  const values: string[] = [];
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    for (let column = 1; column <= 16; column += 1) {
      const value = sheet.getCell(row, column).value;
      if (typeof value === "string") values.push(value);
    }
  }
  expect(values).toContain("Disiapkan oleh,");
  expect(values).toContain("Pelaksana");
  expect(values).toContain("Diperiksa oleh,");
  expect(values).toContain("Konsultan Pengawas");
  expect(values).toContain("Disetujui oleh,");
  expect(values).toContain("Pemilik");
});

test("an unknown report date falls back to the latest snapshot on export input", async () => {
  const snapshotItems = await parsedItems();
  const workbook = new ExcelJS.Workbook();
  addDailyReportSheet(workbook, {
    sheetName: "Laporan Harian",
    projectName: "P",
    projectCode: "C",
    client: null,
    location: null,
    periodLabel: null,
    snapshot: { reportDate: "2026-08-22", cumulativePercent: 56.9230209578 },
    items: reportItems(snapshotItems),
  });
  const sheet = workbook.getWorksheet("Laporan Harian");
  // The subtitle omits the missing client/location instead of printing "null".
  expect(sheet?.getCell("A2").value).toBe("C");
});

test("daily readings overlay only the periods the actual curve does not cover", () => {
  const overlay = overlayDailyCurveReadings(
    [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
    new Set(["p2"]),
    [
      { periodId: "p1", reportDate: "2026-08-16", cumulativePercent: 40.1 },
      { periodId: "p1", reportDate: "2026-08-18", cumulativePercent: 42.7 },
      { periodId: "p3", reportDate: "2026-08-22", cumulativePercent: 56.92 },
    ],
  );

  // p2 belongs to the imported curve; p1 keeps its latest reading; p3 fills.
  expect(overlay).toEqual([
    { periodId: "p1", cumulativePercent: 42.7 },
    { periodId: "p3", cumulativePercent: 56.92 },
  ]);
});
