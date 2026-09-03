import type ExcelJS from "exceljs";

import { columnLetter, parseNumber, readCell } from "./boq-import-parse";

type Workbook = ExcelJS.Workbook;
type Worksheet = ExcelJS.Worksheet;

export type DailyProgressMapping = {
  code?: number;
  description: number;
  quantity: number;
  unit?: number;
  unitRate: number;
  amount: number;
  weight: number;
  previousPercent: number;
  previousWeighted: number;
  currentPercent: number;
  currentWeighted: number;
  cumulativePercent: number;
  cumulativeWeighted: number;
  remainingPercent: number;
  remainingWeighted: number;
  remark?: number;
};

export type DailyProgressPlan = {
  version: 1;
  mappingSource: "deterministic" | "ai";
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
  mapping: DailyProgressMapping;
  sheets: { sheetName: string; reportDate: string }[];
};

export type ParsedDailyProgressItem = {
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
  sourceValues: Record<string, string | number | null>;
};

export type ParsedDailyProgressSnapshot = {
  reportDate: string;
  sourceSheetName: string;
  cumulativePercent: number;
  items: ParsedDailyProgressItem[];
};

export type DailyProgressPreview = {
  sheetCount: number;
  itemCount: number;
  dates: string[];
  movementDates: string[];
  latestCumulativePercent: number;
  ignoredSheets: string[];
};

export type ParsedDailyProgress = {
  plan: DailyProgressPlan;
  snapshots: ParsedDailyProgressSnapshot[];
  preview: DailyProgressPreview;
  errors: { row: number; column: string | null; message: string }[];
};

const MONTHS = new Map<string, number>([
  ["JANUARY", 1],
  ["JANUARI", 1],
  ["FEBRUARY", 2],
  ["FEBRUARI", 2],
  ["MARCH", 3],
  ["MARET", 3],
  ["APRIL", 4],
  ["MAY", 5],
  ["MEI", 5],
  ["JUNE", 6],
  ["JUNI", 6],
  ["JULY", 7],
  ["JULI", 7],
  ["AUGUST", 8],
  ["AGUSTUS", 8],
  ["SEPTEMBER", 9],
  ["OCTOBER", 10],
  ["OKTOBER", 10],
  ["NOVEMBER", 11],
  ["DECEMBER", 12],
  ["DESEMBER", 12],
]);

const TOLERANCE = 0.011;

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function textAt(sheet: Worksheet, row: number, column: number) {
  const value = readCell(sheet.getRow(row).getCell(column).value);
  return value.kind === "empty" ? "" : String(value.value).trim();
}

function numberAt(sheet: Worksheet, row: number, column: number) {
  return parseNumber(readCell(sheet.getRow(row).getCell(column).value));
}

function requiredNumber(
  sheet: Worksheet,
  row: number,
  column: number,
  field: string,
  errors: ParsedDailyProgress["errors"],
) {
  const value = numberAt(sheet, row, column);
  if (typeof value !== "number") {
    errors.push({ row, column: columnLetter(column), message: `${field} must be numeric.` });
    return null;
  }
  return value;
}

function optionalNumber(
  sheet: Worksheet,
  row: number,
  column: number,
  field: string,
  errors: ParsedDailyProgress["errors"],
) {
  const value = numberAt(sheet, row, column);
  if (value === null) return null;
  if (value === "invalid") {
    errors.push({ row, column: columnLetter(column), message: `${field} must be numeric.` });
    return null;
  }
  return value;
}

function percentAt(
  sheet: Worksheet,
  row: number,
  column: number,
  field: string,
  errors: ParsedDailyProgress["errors"],
) {
  const value = optionalNumber(sheet, row, column, field, errors);
  if (value === null) return null;
  const cell = sheet.getRow(row).getCell(column);
  const percent = cell.numFmt.includes("%") ? value * 100 : value;
  if (percent < -TOLERANCE || percent > 100 + TOLERANCE) {
    errors.push({
      row,
      column: columnLetter(column),
      message: `${field} must be between 0% and 100%.`,
    });
  }
  return percent;
}

export function parseDailySheetDate(name: string) {
  const match = normalized(name).match(/^(\d{1,2})[ -]([A-Z]+)[ -](\d{4})$/);
  if (!match) return null;
  const month = MONTHS.get(match[2]!);
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

export function dailyProgressSheetDates(workbook: Workbook) {
  return workbook.worksheets
    .map((sheet) => ({ sheetName: sheet.name, reportDate: parseDailySheetDate(sheet.name) }))
    .filter(
      (sheet): sheet is { sheetName: string; reportDate: string } => sheet.reportDate !== null,
    )
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function combinedHeader(sheet: Worksheet, headerRow: number, column: number) {
  return normalized(
    `${textAt(sheet, headerRow, column)} ${textAt(sheet, headerRow + 1, column)}`,
  );
}

function findHeaderRow(sheet: Worksheet) {
  for (let row = 1; row <= Math.min(sheet.rowCount, 30); row++) {
    const headers = Array.from({ length: Math.min(sheet.columnCount, 30) }, (_, index) =>
      normalized(textAt(sheet, row, index + 1)),
    ).join(" ");
    if (
      /(URAIAN|DESCRIPTION|WORK ITEM)/.test(headers) &&
      /(BOBOT|WEIGHT)/.test(headers) &&
      /(PROGRESS|PROGRES)/.test(headers)
    ) {
      return row;
    }
  }
  return null;
}

function findColumn(
  headers: string[],
  include: RegExp,
  exclude?: RegExp,
) {
  const index = headers.findIndex((header) => include.test(header) && !(exclude?.test(header) ?? false));
  return index < 0 ? undefined : index + 1;
}

function descriptionColumn(sheet: Worksheet, headerRow: number, candidates: number[]) {
  let best = candidates[0];
  let bestScore = -1;
  for (const column of candidates) {
    let score = 0;
    for (let row = headerRow + 2; row <= Math.min(sheet.rowCount, headerRow + 250); row++) {
      if (textAt(sheet, row, column) && typeof numberAt(sheet, row, 7) === "number") score++;
    }
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }
  return best;
}

export function detectDailyProgressPlan(workbook: Workbook): DailyProgressPlan | null {
  const sheets = dailyProgressSheetDates(workbook);
  if (sheets.length < 2) return null;
  const first = workbook.getWorksheet(sheets[0]!.sheetName);
  if (!first) return null;
  const headerRow = findHeaderRow(first);
  if (!headerRow) return null;
  const headers = Array.from({ length: Math.min(first.columnCount, 40) }, (_, index) =>
    combinedHeader(first, headerRow, index + 1),
  );
  const descriptions = headers
    .map((header, index) => ({ header, column: index + 1 }))
    .filter(({ header }) => /(URAIAN|DESCRIPTION|WORK ITEM)/.test(header))
    .map(({ column }) => column);
  const mapping: Partial<DailyProgressMapping> = {
    code: findColumn(headers, /^(NO|NO\.|CODE|KODE)( |$)/),
    description: descriptions.length ? descriptionColumn(first, headerRow, descriptions) : undefined,
    quantity: findColumn(headers, /^(VOL|VOLUME|QTY|QUANTITY)( |$)/),
    unit: findColumn(headers, /^(SAT|SATUAN|UNIT)( |$)/),
    unitRate: findColumn(headers, /(HARGA SATUAN|UNIT RATE|UNIT PRICE)/),
    amount: findColumn(headers, /(JUMLAH HARGA|AMOUNT|TOTAL VALUE|NILAI)/),
    weight: findColumn(headers, /(BOBOT|WEIGHT)/, /(PROGRESS|PROGRES|MINGGU|CURRENT|CUMULATIVE|REMAIN)/),
    previousPercent: findColumn(headers, /(MINGGU LALU|PREVIOUS).*(PERSENTASE|PERCENTAGE)/),
    previousWeighted: findColumn(headers, /(MINGGU LALU|PREVIOUS).*(BOBOT|WEIGHT)/),
    currentPercent: findColumn(headers, /(SAAT INI|CURRENT|TODAY).*(PERSENTASE|PERCENTAGE)/),
    currentWeighted: findColumn(headers, /(SAAT INI|CURRENT|TODAY).*(BOBOT|WEIGHT)/),
    cumulativePercent: findColumn(headers, /(S\/D|CUMULATIVE|TO DATE).*(PERSENTASE|PERCENTAGE)/),
    cumulativeWeighted: findColumn(headers, /(S\/D|CUMULATIVE|TO DATE).*(BOBOT|WEIGHT)/),
    remainingPercent: findColumn(headers, /(SISA|REMAIN).*(PERSENTASE|PERCENTAGE)/),
    remainingWeighted: findColumn(headers, /(SISA|REMAIN).*(BOBOT|WEIGHT)/),
    remark: findColumn(headers, /(REMARK|CATATAN|NOTE)/),
  };

  const required = [
    "description",
    "quantity",
    "unitRate",
    "amount",
    "weight",
    "previousPercent",
    "previousWeighted",
    "currentPercent",
    "currentWeighted",
    "cumulativePercent",
    "cumulativeWeighted",
    "remainingPercent",
    "remainingWeighted",
  ] as const;
  if (required.some((field) => mapping[field] === undefined)) return null;

  let dataEndRow = 0;
  for (let row = headerRow + 2; row <= first.rowCount; row++) {
    const label = normalized(textAt(first, row, mapping.description!));
    if (/^GRAND TOTAL\b/.test(label)) {
      dataEndRow = row - 1;
      break;
    }
  }
  if (!dataEndRow) {
    for (let row = headerRow + 2; row <= first.rowCount; row++) {
      if (
        typeof numberAt(first, row, mapping.quantity!) === "number" &&
        typeof numberAt(first, row, mapping.amount!) === "number"
      ) {
        dataEndRow = row;
      }
    }
  }
  if (!dataEndRow) return null;

  return {
    version: 1,
    mappingSource: "deterministic",
    headerRow,
    dataStartRow: headerRow + 2,
    dataEndRow,
    mapping: mapping as DailyProgressMapping,
    sheets,
  };
}

function sourceValues(sheet: Worksheet, row: number) {
  const values: Record<string, string | number | null> = {};
  for (let column = 1; column <= Math.min(sheet.columnCount, 40); column++) {
    const cell = readCell(sheet.getRow(row).getCell(column).value);
    values[columnLetter(column)] =
      cell.kind === "empty" ? null : cell.kind === "number" ? cell.value : String(cell.value);
  }
  return values;
}

function itemIdentity(item: ParsedDailyProgressItem) {
  return `${item.sourceRow}\0${normalized(item.code ?? "")}\0${normalized(item.description)}`;
}

export function parseDailyProgressWorkbook(
  workbook: Workbook,
  submittedPlan?: DailyProgressPlan,
): ParsedDailyProgress | null {
  const detected = detectDailyProgressPlan(workbook);
  const plan = submittedPlan ?? detected;
  if (!plan) return null;
  const actualSheets = dailyProgressSheetDates(workbook);
  const maximumColumn = Math.max(...Object.values(plan.mapping).filter((value) => value !== undefined));
  const planIsSafe =
    JSON.stringify(actualSheets) === JSON.stringify(plan.sheets) &&
    plan.dataStartRow > plan.headerRow &&
    plan.dataEndRow >= plan.dataStartRow &&
    plan.sheets.every((source) => {
      const sheet = workbook.getWorksheet(source.sheetName);
      return sheet && plan.dataEndRow <= sheet.rowCount && maximumColumn <= sheet.columnCount;
    });
  const deterministicPlanMatches =
    plan.mappingSource !== "deterministic" ||
    (detected !== null && JSON.stringify(detected) === JSON.stringify(plan));
  if (!planIsSafe || !deterministicPlanMatches) {
    return null;
  }

  const errors: ParsedDailyProgress["errors"] = [];
  const snapshots: ParsedDailyProgressSnapshot[] = [];
  let expectedItems = new Map<string, ParsedDailyProgressItem>();
  let previousItems = new Map<string, ParsedDailyProgressItem>();

  for (const source of plan.sheets) {
    const sheet = workbook.getWorksheet(source.sheetName);
    if (!sheet) return null;
    const items: ParsedDailyProgressItem[] = [];
    let sectionCode: string | null = null;
    let sectionDescription: string | null = null;
    let parentCode: string | null = null;
    let parentDescription: string | null = null;
    for (let row = plan.dataStartRow; row <= plan.dataEndRow; row++) {
      const quantity = numberAt(sheet, row, plan.mapping.quantity);
      const amount = numberAt(sheet, row, plan.mapping.amount);
      const weight = numberAt(sheet, row, plan.mapping.weight);
      const description = textAt(sheet, row, plan.mapping.description);
      // Totals and headings have no quantity. A genuine detail row has all
      // three pricing values, including zero where zero was explicitly typed.
      if (
        !description ||
        typeof quantity !== "number" ||
        typeof amount !== "number" ||
        typeof weight !== "number"
      ) {
        const code = plan.mapping.code ? textAt(sheet, row, plan.mapping.code) : textAt(sheet, row, 1);
        const fallbackLabel = Array.from(
          { length: Math.max(0, plan.mapping.quantity - 1) },
          (_, index) => index + 1,
        )
          .filter((column) => column !== plan.mapping.code)
          .map((column) => textAt(sheet, row, column))
          .find((value) => value && value !== code);
        const label = description || fallbackLabel || "";
        if (/^BILL\b/i.test(code)) {
          sectionCode = code;
          sectionDescription = label || code;
          parentCode = null;
          parentDescription = null;
        } else if (
          code &&
          label &&
          !/^TOTAL\b/i.test(code) &&
          !/^GRAND TOTAL\b/i.test(label)
        ) {
          parentCode = code;
          parentDescription = label;
        }
        continue;
      }
      const unitRate = requiredNumber(sheet, row, plan.mapping.unitRate, "Unit rate", errors);
      if (unitRate === null) continue;
      const previous = percentAt(
        sheet,
        row,
        plan.mapping.previousPercent,
        "Previous progress",
        errors,
      );
      const current = percentAt(
        sheet,
        row,
        plan.mapping.currentPercent,
        "Current progress",
        errors,
      );
      const cumulative = percentAt(
        sheet,
        row,
        plan.mapping.cumulativePercent,
        "Cumulative progress",
        errors,
      );
      const remaining = percentAt(
        sheet,
        row,
        plan.mapping.remainingPercent,
        "Remaining progress",
        errors,
      );
      const previousWeighted = optionalNumber(
        sheet,
        row,
        plan.mapping.previousWeighted,
        "Previous weighted progress",
        errors,
      );
      const currentWeighted = optionalNumber(
        sheet,
        row,
        plan.mapping.currentWeighted,
        "Current weighted progress",
        errors,
      );
      const cumulativeWeighted = optionalNumber(
        sheet,
        row,
        plan.mapping.cumulativeWeighted,
        "Cumulative weighted progress",
        errors,
      );
      const remainingWeighted = optionalNumber(
        sheet,
        row,
        plan.mapping.remainingWeighted,
        "Remaining weighted progress",
        errors,
      );
      const normalizedPrevious = previous ?? 0;
      const normalizedCumulative = cumulative ?? (remaining === null ? 0 : 100 - remaining);
      const normalizedRemaining = remaining ?? 100 - normalizedCumulative;
      const normalizedPreviousWeighted = previousWeighted ?? (normalizedPrevious / 100) * weight;
      const normalizedCumulativeWeighted =
        cumulativeWeighted ?? (normalizedCumulative / 100) * weight;
      const normalizedRemainingWeighted =
        remainingWeighted ?? (normalizedRemaining / 100) * weight;
      if (Math.abs(normalizedPrevious + (current ?? 0) - normalizedCumulative) > TOLERANCE) {
        errors.push({
          row,
          column: columnLetter(plan.mapping.cumulativePercent),
          message: `Cumulative progress on ${source.sheetName} must equal previous plus current progress.`,
        });
      }
      if (Math.abs(normalizedCumulative + normalizedRemaining - 100) > TOLERANCE) {
        errors.push({
          row,
          column: columnLetter(plan.mapping.remainingPercent),
          message: `Cumulative and remaining progress on ${source.sheetName} must total 100%.`,
        });
      }
      if (Math.abs(normalizedCumulativeWeighted - (normalizedCumulative / 100) * weight) > TOLERANCE) {
        errors.push({
          row,
          column: columnLetter(plan.mapping.cumulativeWeighted),
          message: `Weighted cumulative progress on ${source.sheetName} does not match weight × completion.`,
        });
      }
      const item: ParsedDailyProgressItem = {
        sourceRow: row,
        code: plan.mapping.code ? textAt(sheet, row, plan.mapping.code) || null : null,
        description,
        sectionCode,
        sectionDescription,
        parentCode,
        parentDescription,
        unit: plan.mapping.unit ? textAt(sheet, row, plan.mapping.unit) || null : null,
        quantity,
        unitRate,
        amount,
        weight,
        previousPercent: normalizedPrevious,
        currentPercent: current,
        cumulativePercent: normalizedCumulative,
        remainingPercent: normalizedRemaining,
        previousWeighted: normalizedPreviousWeighted,
        currentWeighted,
        cumulativeWeighted: normalizedCumulativeWeighted,
        remainingWeighted: normalizedRemainingWeighted,
        remark: plan.mapping.remark ? textAt(sheet, row, plan.mapping.remark) || null : null,
        sourceValues: sourceValues(sheet, row),
      };
      items.push(item);
    }

    const currentItems = new Map(items.map((item) => [itemIdentity(item), item]));
    if (snapshots.length === 0) {
      expectedItems = currentItems;
    } else {
      if (currentItems.size !== expectedItems.size) {
        errors.push({
          row: plan.dataStartRow,
          column: null,
          message: `${source.sheetName} has ${currentItems.size} detail rows; expected ${expectedItems.size}.`,
        });
      }
      for (const [identity, expected] of expectedItems) {
        const item = currentItems.get(identity);
        if (!item) {
          errors.push({
            row: expected.sourceRow,
            column: null,
            message: `${source.sheetName} is missing ${expected.description}.`,
          });
          continue;
        }
        if (
          item.quantity !== expected.quantity ||
          item.unitRate !== expected.unitRate ||
          item.amount !== expected.amount ||
          Math.abs(item.weight - expected.weight) > 0.000001
        ) {
          errors.push({
            row: item.sourceRow,
            column: null,
            message: `${item.description} changes pricing or weight between dated sheets.`,
          });
        }
        const prior = previousItems.get(identity);
        if (prior && item.cumulativePercent + TOLERANCE < prior.cumulativePercent) {
          errors.push({
            row: item.sourceRow,
            column: columnLetter(plan.mapping.cumulativePercent),
            message: `${item.description} decreases from the previous dated sheet.`,
          });
        }
      }
    }
    previousItems = currentItems;
    const aggregate = items.reduce((total, item) => total + item.cumulativeWeighted, 0);
    snapshots.push({
      reportDate: source.reportDate,
      sourceSheetName: source.sheetName,
      cumulativePercent: aggregate,
      items,
    });
  }

  const ignored = workbook.worksheets
    .map((sheet) => sheet.name)
    .filter((name) => !plan.sheets.some((sheet) => sheet.sheetName === name));
  return {
    plan,
    snapshots,
    preview: {
      sheetCount: snapshots.length,
      itemCount: snapshots[0]?.items.length ?? 0,
      dates: snapshots.map((snapshot) => snapshot.reportDate),
      movementDates: snapshots
        .filter((snapshot) => snapshot.items.some((item) => (item.currentPercent ?? 0) > 0))
        .map((snapshot) => snapshot.reportDate),
      latestCumulativePercent: snapshots.at(-1)?.cumulativePercent ?? 0,
      ignoredSheets: ignored,
    },
    errors,
  };
}
