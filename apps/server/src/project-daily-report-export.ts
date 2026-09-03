import type ExcelJS from "exceljs";

import { MONEY_FORMAT } from "./export-format";

/**
 * Signature-ready replica of the contractor's dated progress sheet.
 *
 * Deliberately holds no exceljs import at runtime and no database access: the
 * builder takes plain data and an already-open workbook, so it can be tested
 * against the reference workbook without a project row.
 *
 * Labels are always Indonesian — this sheet exists to be printed and signed
 * where the paper workflow is Indonesian, independent of the dashboard locale.
 */

const REPORT_PERCENT_FORMAT = "0.00%";
const COLUMNS = 16;
const HEADER_TOP = 5;
const HEADER_BOTTOM = 6;

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E78" },
};
const SECTION_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFDCE6F1" },
};
const MOVEMENT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFDF3E3" },
};
const TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F2F2" },
};
const BORDER_COLOR = { argb: "FFB0BEC9" };

export type DailyReportSnapshot = {
  reportDate: string;
  cumulativePercent: number;
};

export type DailyReportItem = {
  sourceRow: number;
  code: string | null;
  description: string;
  sectionCode: string | null;
  sectionDescription: string | null;
  parentCode: string | null;
  parentDescription: string | null;
  unit: string | null;
  quantity: number;
  unitRate: number;
  amount: number;
  weight: number;
  previousPercent: number;
  currentPercent: number | null;
  cumulativePercent: number;
  remainingPercent: number;
  previousWeighted: number;
  currentWeighted: number | null;
  cumulativeWeighted: number;
  remainingWeighted: number;
  remark: string | null;
};

export type DailyReportInput = {
  sheetName: string;
  projectName: string;
  projectCode: string;
  client: string | null;
  location: string | null;
  periodLabel: string | null;
  snapshot: DailyReportSnapshot;
  items: DailyReportItem[];
};

/** One dated daily reading, reduced to what the curve overlay needs. */
export type DailyCurveReading = {
  periodId: string;
  reportDate: string;
  cumulativePercent: number;
};

/**
 * The dated daily readings that fill reporting periods the imported actual
 * curve does not already cover — the same rule the import applies, applied at
 * read time, so the period tab and the chart carry the same cumulative figure
 * the Daily Report sheet asks someone to sign. The latest report date wins
 * when several readings share one period.
 */
export function overlayDailyCurveReadings<P extends { id: string }>(
  periods: readonly P[],
  coveredPeriodIds: ReadonlySet<string>,
  readings: readonly DailyCurveReading[],
): { periodId: string; cumulativePercent: number }[] {
  const latestByPeriod = new Map<string, DailyCurveReading>();
  for (const reading of readings) {
    latestByPeriod.set(reading.periodId, reading);
  }
  const overlays: { periodId: string; cumulativePercent: number }[] = [];
  for (const period of periods) {
    if (coveredPeriodIds.has(period.id)) continue;
    const reading = latestByPeriod.get(period.id);
    if (reading) {
      overlays.push({ periodId: period.id, cumulativePercent: reading.cumulativePercent });
    }
  }
  return overlays;
}

function bordered(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: "thin", color: BORDER_COLOR },
    left: { style: "thin", color: BORDER_COLOR },
    bottom: { style: "thin", color: BORDER_COLOR },
    right: { style: "thin", color: BORDER_COLOR },
  };
}

function sectionBanner(sheet: ExcelJS.Worksheet, row: number, text: string) {
  sheet.mergeCells(row, 1, row, COLUMNS);
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, color: { argb: "FF173D43" } };
  cell.alignment = { vertical: "middle" };
  for (let column = 1; column <= COLUMNS; column += 1) {
    const borderedCell = sheet.getCell(row, column);
    borderedCell.fill = SECTION_FILL;
    bordered(borderedCell);
  }
}

export function addDailyReportSheet(workbook: ExcelJS.Workbook, input: DailyReportInput) {
  const sheet = workbook.addWorksheet(input.sheetName, {
    properties: { showGridLines: false },
    views: [{ state: "frozen", ySplit: HEADER_BOTTOM }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
    },
  });
  const widths = [8, 46, 9, 8, 15, 16, 10, 10, 10, 10, 10, 10, 10, 10, 10, 18];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.mergeCells(1, 1, 1, COLUMNS);
  const title = sheet.getCell(1, 1);
  title.value = `MONITORING PROGRESS — ${input.projectName}`;
  title.font = { bold: true, size: 14, color: { argb: "FF173D43" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 22;

  sheet.mergeCells(2, 1, 2, COLUMNS);
  const subtitle = sheet.getCell(2, 1);
  subtitle.value =
    [input.projectCode, input.client, input.location]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part))
      .join(" · ") || null;
  subtitle.alignment = { horizontal: "center", vertical: "middle" };
  subtitle.font = { color: { argb: "FF5A6B7B" } };

  sheet.mergeCells(3, 1, 3, COLUMNS);
  const meta = sheet.getCell(3, 1);
  meta.value = `Tanggal laporan: ${input.snapshot.reportDate}${
    input.periodLabel ? ` · ${input.periodLabel}` : ""
  }`;
  meta.font = { bold: true };
  meta.alignment = { horizontal: "center", vertical: "middle" };

  const headerSpans: [number, number, string][] = [
    [1, 1, "NO"],
    [2, 2, "URAIAN PEKERJAAN"],
    [3, 3, "VOL"],
    [4, 4, "SAT"],
    [5, 5, "HARGA SATUAN (Rp)"],
    [6, 6, "JUMLAH HARGA (Rp)"],
    [7, 7, "BOBOT (%)"],
    [8, 9, "PROGRESS MINGGU LALU"],
    [10, 11, "PROGRESS SAAT INI"],
    [12, 13, "PROGRESS S/D MINGGU INI"],
    [14, 15, "SISA PROGRESS"],
    [16, 16, "REMARKS"],
  ];
  for (const [from, to, label] of headerSpans) {
    if (to > from) sheet.mergeCells(HEADER_TOP, from, HEADER_TOP, to);
    sheet.getCell(HEADER_TOP, from).value = label;
  }
  const subLabels: [number, string][] = [
    [8, "PERSENTASE"],
    [9, "BOBOT"],
    [10, "PERSENTASE"],
    [11, "BOBOT"],
    [12, "PERSENTASE"],
    [13, "BOBOT"],
    [14, "PERSENTASE"],
    [15, "BOBOT"],
  ];
  for (const [column, label] of subLabels) {
    sheet.getCell(HEADER_BOTTOM, column).value = label;
  }
  for (let row = HEADER_TOP; row <= HEADER_BOTTOM; row += 1) {
    sheet.getRow(row).height = row === HEADER_TOP ? 20 : 16;
    for (let column = 1; column <= COLUMNS; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.fill = HEADER_FILL;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      bordered(cell);
    }
  }

  const fraction = (value: number | null) => (value === null ? null : value / 100);
  let row = HEADER_BOTTOM + 1;
  let lastSection: string | null = null;
  let lastParent: string | null = null;
  for (const item of input.items) {
    if (item.sectionCode !== null && item.sectionCode !== lastSection) {
      sectionBanner(
        sheet,
        row,
        `${item.sectionCode} — ${item.sectionDescription ?? item.sectionCode}`,
      );
      row += 1;
      lastSection = item.sectionCode;
      lastParent = null;
    }
    if (item.parentCode !== null && item.parentCode !== lastParent) {
      const parentRow = sheet.getRow(row);
      parentRow.getCell(1).value = item.parentCode;
      parentRow.getCell(2).value = item.parentDescription ?? item.parentCode;
      for (let column = 1; column <= COLUMNS; column += 1) {
        const cell = parentRow.getCell(column);
        cell.font = { bold: true };
        bordered(cell);
      }
      parentRow.getCell(2).alignment = { vertical: "middle", wrapText: true };
      row += 1;
      lastParent = item.parentCode;
    }
    const itemRow = sheet.getRow(row);
    const values: (string | number | null)[] = [
      item.code ?? "",
      item.description,
      item.quantity,
      item.unit ?? "",
      item.unitRate,
      item.amount,
      fraction(item.weight),
      fraction(item.previousPercent),
      fraction(item.previousWeighted),
      fraction(item.currentPercent),
      fraction(item.currentWeighted),
      fraction(item.cumulativePercent),
      fraction(item.cumulativeWeighted),
      fraction(item.remainingPercent),
      fraction(item.remainingWeighted),
      item.remark ?? "",
    ];
    values.forEach((value, index) => {
      itemRow.getCell(index + 1).value = value;
    });
    const moved = (item.currentPercent ?? 0) > 0 || (item.currentWeighted ?? 0) > 0;
    for (let column = 1; column <= COLUMNS; column += 1) {
      const cell = itemRow.getCell(column);
      bordered(cell);
      if (moved) cell.fill = MOVEMENT_FILL;
      if (column === 2 || column === 16) {
        cell.alignment = { vertical: "top", wrapText: true };
      } else if (column === 1 || column === 4) {
        cell.alignment = { horizontal: "center", vertical: "top" };
      }
      if (column === 5 || column === 6) cell.numFmt = MONEY_FORMAT;
      if (column >= 7 && column <= 15) cell.numFmt = REPORT_PERCENT_FORMAT;
    }
    row += 1;
  }

  const sum = (pick: (item: DailyReportItem) => number) =>
    input.items.reduce((total, item) => total + pick(item), 0);
  const hasMovement = input.items.some((item) => item.currentWeighted !== null);
  const totalRow = sheet.getRow(row);
  sheet.mergeCells(row, 1, row, 6);
  totalRow.getCell(1).value = "GRAND TOTAL";
  totalRow.getCell(7).value = fraction(sum((item) => item.weight));
  totalRow.getCell(9).value = fraction(sum((item) => item.previousWeighted));
  totalRow.getCell(11).value = hasMovement
    ? fraction(sum((item) => item.currentWeighted ?? 0))
    : null;
  totalRow.getCell(12).value = fraction(input.snapshot.cumulativePercent);
  totalRow.getCell(13).value = fraction(sum((item) => item.cumulativeWeighted));
  totalRow.getCell(15).value = fraction(sum((item) => item.remainingWeighted));
  for (let column = 1; column <= COLUMNS; column += 1) {
    const cell = totalRow.getCell(column);
    cell.font = { bold: true };
    cell.fill = TOTAL_FILL;
    cell.border = {
      top: { style: "double", color: { argb: "FF173D43" } },
      left: { style: "thin", color: BORDER_COLOR },
      bottom: { style: "thin", color: BORDER_COLOR },
      right: { style: "thin", color: BORDER_COLOR },
    };
    if (column >= 7 && column <= 15) cell.numFmt = REPORT_PERCENT_FORMAT;
  }
  totalRow.getCell(1).alignment = { horizontal: "right", vertical: "middle" };
  row += 2;

  const parties: [number, string, string][] = [
    [2, "Disiapkan oleh,", "Pelaksana"],
    [7, "Diperiksa oleh,", "Konsultan Pengawas"],
    [12, "Disetujui oleh,", "Pemilik"],
  ];
  for (const [column, greeting, role] of parties) {
    sheet.mergeCells(row, column, row, column + 3);
    sheet.getCell(row, column).value = greeting;
    sheet.mergeCells(row + 1, column, row + 1, column + 3);
    sheet.getCell(row + 1, column).value = role;
    sheet.getCell(row + 1, column).font = { bold: true };
    sheet.mergeCells(row + 5, column, row + 5, column + 3);
    sheet.getCell(row + 5, column).value = "( ................................ )";
    sheet.mergeCells(row + 6, column, row + 6, column + 3);
    sheet.getCell(row + 6, column).value = `Tanggal: ${input.snapshot.reportDate}`;
  }
}
