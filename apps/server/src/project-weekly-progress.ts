import type ExcelJS from "exceljs";

import {
  columnLetter,
  BOQ_NUMERIC_SCALE,
  parseNumber,
  readCell,
  type ImportError,
  type ParsedRow,
} from "./boq-import-parse";

const DETAIL_SHEETS = [
  "I. PERSIAPAN",
  "II.PEK. LUAR",
  "III.BODY REPAIR",
  "IV.GENERAL REPAIR",
  "V.OFFICE & SHOWROOM",
  "VI.KONDISI EXISTING",
  "I. Mek. Infrastruktur",
  "II. Mek. Body Repair",
  "III. Mek. General Repair",
  "I. Elektrikal Infrastruktur",
  "II. Elektrikal Body Repair",
  "III. Elektrikal General Repair",
  "IV. Elekt Office & Showroom",
  "I. Elektronik Body Repair",
] as const;

const CATEGORY_DEFINITIONS = [
  { key: "I", description: "PEKERJAAN PERSIAPAN", curveRow: 10 },
  { key: "II-A", description: "PEKERJAAN LUAR - BONGKARAN", curveRow: 12 },
  { key: "II-B", description: "PEKERJAAN LUAR - SALURAN", curveRow: 13 },
  { key: "II-C", description: "PEKERJAAN LUAR - PAVING BLOCK", curveRow: 15 },
  { key: "II-D", description: "PEKERJAAN LUAR - LAIN-LAIN", curveRow: 18 },
  { key: "II-E", description: "PEKERJAAN LUAR - MEKANIKAL", curveRow: 19 },
  { key: "II-F", description: "PEKERJAAN LUAR - ELEKTRIKAL", curveRow: 20 },
  { key: "III-A", description: "BODY REPAIR - STRUKTUR", curveRow: 22 },
  { key: "III-B", description: "BODY REPAIR - ARSITEKTUR", curveRow: 27 },
  { key: "III-C", description: "BODY REPAIR - MEKANIKAL", curveRow: 28 },
  { key: "III-D", description: "BODY REPAIR - ELEKTRIKAL", curveRow: 29 },
  { key: "III-E", description: "BODY REPAIR - ELEKTRONIK", curveRow: 30 },
  { key: "IV-A", description: "GENERAL REPAIR - STRUKTUR", curveRow: 32 },
  { key: "IV-B", description: "GENERAL REPAIR - ARSITEKTUR", curveRow: 33 },
  { key: "IV-C", description: "GENERAL REPAIR - MEKANIKAL", curveRow: 34 },
  { key: "IV-D", description: "GENERAL REPAIR - ELEKTRIKAL", curveRow: 35 },
  { key: "V-A", description: "OFFICE & SHOWROOM - ARSITEKTUR", curveRow: 37 },
  { key: "V-B", description: "OFFICE & SHOWROOM - ELEKTRIKAL", curveRow: 38 },
  { key: "VI-A", description: "KONDISI EXISTING - PEMBONGKARAN & PERBAIKAN", curveRow: 40 },
] as const;

type CategoryKey = (typeof CATEGORY_DEFINITIONS)[number]["key"];

type DetailLayout = {
  sheetName: (typeof DETAIL_SHEETS)[number];
  descriptionColumns: number[];
  headingColumns: number[];
  unitColumn: number;
  quantityColumn: number;
  unitRateColumn: number;
  amountColumn: number;
  weightColumn: number;
  previousQuantityColumn: number;
  previousPercentColumn: number;
  currentQuantityColumn: number;
  currentPercentColumn: number;
  fixedCategory?: CategoryKey;
  headingCategories?: { key: CategoryKey; pattern: RegExp }[];
};

const DETAIL_LAYOUTS: DetailLayout[] = [
  layout("I. PERSIAPAN", [4], [2, 3, 4], 5, 7, 8, 9, 10, 11, 12, 17, 18, "I"),
  {
    ...layout("II.PEK. LUAR", [4], [2, 3, 4], 5, 7, 8, 9, 10, 11, 12, 17, 18),
    headingCategories: [
      { key: "II-A", pattern: /\bPEKERJAAN BONGKARAN\b/ },
      { key: "II-B", pattern: /\bPEKERJAAN SALURAN\b/ },
      { key: "II-C", pattern: /\bPEKERJAAN PAVING BLOCK\b/ },
      { key: "II-D", pattern: /\bPEKERJAAN LAIN[- ]LAIN\b/ },
    ],
  },
  {
    ...layout("III.BODY REPAIR", [3], [2, 3], 4, 6, 7, 8, 9, 10, 11, 16, 17),
    headingCategories: [
      { key: "III-A", pattern: /\bPEKERJAAN STRUKTUR$/ },
      { key: "III-B", pattern: /\bPEKERJAAN ARSITEKTUR$/ },
    ],
  },
  {
    ...layout("IV.GENERAL REPAIR", [5], [2, 3, 4, 5], 6, 8, 9, 10, 11, 12, 13, 18, 19),
    headingCategories: [
      { key: "IV-A", pattern: /\bPEKERJAAN STRUKTUR$/ },
      { key: "IV-B", pattern: /\bPEKERJAAN ARSITEKTUR$/ },
    ],
  },
  layout("V.OFFICE & SHOWROOM", [5], [2, 3, 4, 5], 6, 8, 9, 10, 11, 12, 13, 18, 19, "V-A"),
  layout("VI.KONDISI EXISTING", [4], [1, 2, 3, 4], 5, 7, 8, 9, 10, 11, 12, 17, 18, "VI-A"),
  layout("I. Mek. Infrastruktur", [3], [2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "II-E"),
  layout("II. Mek. Body Repair", [2], [1, 2], 3, 4, 5, 6, 7, 8, 9, 14, 15, "III-C"),
  layout("III. Mek. General Repair", [2], [1, 2], 3, 4, 5, 6, 7, 8, 9, 14, 15, "IV-C"),
  layout("I. Elektrikal Infrastruktur", [3, 2], [1, 2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "II-F"),
  layout("II. Elektrikal Body Repair", [3, 2], [1, 2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "III-D"),
  layout("III. Elektrikal General Repair", [3, 2], [1, 2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "IV-D"),
  layout("IV. Elekt Office & Showroom", [3, 2], [1, 2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "V-B"),
  layout("I. Elektronik Body Repair", [3, 2], [1, 2, 3], 4, 5, 6, 7, 8, 9, 10, 15, 16, "III-E"),
];

function layout(
  sheetName: DetailLayout["sheetName"],
  descriptionColumns: number[],
  headingColumns: number[],
  unitColumn: number,
  quantityColumn: number,
  unitRateColumn: number,
  amountColumn: number,
  weightColumn: number,
  previousQuantityColumn: number,
  previousPercentColumn: number,
  currentQuantityColumn: number,
  currentPercentColumn: number,
  fixedCategory?: CategoryKey,
): DetailLayout {
  return {
    sheetName,
    descriptionColumns,
    headingColumns,
    unitColumn,
    quantityColumn,
    unitRateColumn,
    amountColumn,
    weightColumn,
    previousQuantityColumn,
    previousPercentColumn,
    currentQuantityColumn,
    currentPercentColumn,
    fixedCategory,
  };
}

export type WeeklyProgressPlan = {
  version: 1;
  detailSheetCount: number;
  categoryCount: number;
  previousPeriodIndex: number;
  currentPeriodIndex: number;
};

export type WeeklyItemProgress = {
  row: number;
  periodIndex: number;
  cumulativeQuantity: number;
  pctComplete: number;
  sourceSheetName: string;
  sourceRow: number;
  sourceColumn: number;
  sourceValue: string;
};

export type WeeklyProgressPreview = {
  detailSheetCount: number;
  categoryCount: number;
  previousPeriodIndex: number;
  currentPeriodIndex: number;
  previousEntryCount: number;
  currentEntryCount: number;
  itemizedPreviousPercent: number;
  itemizedCurrentPercent: number;
  aggregatePreviousPercent: number | null;
  aggregateCurrentPercent: number;
  confirmationRequired: boolean;
};

export type WeeklyProgressParse = {
  plan: WeeklyProgressPlan;
  rows: ParsedRow[];
  itemProgress: WeeklyItemProgress[];
  rowSources: Map<number, { sheetName: string; sourceRow: number }>;
  preview: WeeklyProgressPreview;
  totalAmount: number;
  client: string | null;
  errors: ImportError[];
};

type ParsedLeaf = {
  category: CategoryKey;
  sheetName: string;
  sourceRow: number;
  description: string;
  unit: string;
  quantity: number;
  unitRate: number;
  amount: number;
  previousQuantity: number | null;
  previousPercent: number | null;
  currentQuantity: number | null;
  currentPercent: number | null;
};

function textAt(sheet: ExcelJS.Worksheet, row: number, column: number) {
  const cell = readCell(sheet.getRow(row).getCell(column).value);
  return cell.kind === "empty" ? "" : String(cell.value).trim();
}

function numberAt(sheet: ExcelJS.Worksheet, row: number, column: number) {
  return parseNumber(readCell(sheet.getRow(row).getCell(column).value));
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("en-US");
}

function firstText(sheet: ExcelJS.Worksheet, row: number, columns: number[]) {
  for (const column of columns) {
    const value = textAt(sheet, row, column);
    if (value) return value;
  }
  return "";
}

function headingText(sheet: ExcelJS.Worksheet, row: number, columns: number[]) {
  return normalized(columns.map((column) => textAt(sheet, row, column)).filter(Boolean).join(" "));
}

export function isWeeklyProgressWorkbook(
  workbook: ExcelJS.Workbook,
  curveSheet: ExcelJS.Worksheet,
) {
  if (normalized(curveSheet.name) !== "KURVA-S") return false;
  if (!normalized(textAt(curveSheet, 1, 1)).includes("SCHEDULE S CURVE")) return false;
  const recap = workbook.getWorksheet("REKAP TOTAL");
  if (!recap || !normalized(textAt(recap, 1, 2)).includes("REKAPITULASI")) return false;
  return DETAIL_SHEETS.every((name) => {
    const sheet = workbook.getWorksheet(name);
    return sheet && normalized(textAt(sheet, 1, 1) || textAt(sheet, 1, 2)) === "PROGRESS MINGGUAN";
  });
}

function recapSubtotal(workbook: ExcelJS.Workbook) {
  const sheet = workbook.getWorksheet("REKAP TOTAL");
  if (!sheet) return null;
  for (let row = 1; row <= sheet.rowCount; row++) {
    if (normalized(textAt(sheet, row, 4)) === "SUB TOTAL 1") {
      const value = numberAt(sheet, row, 6);
      return typeof value === "number" ? value : null;
    }
  }
  return null;
}

function categoryPlans(curveSheet: ExcelJS.Worksheet, errors: ImportError[]) {
  const result = new Map<CategoryKey, { periodIndex: number; plannedPct: number }[]>();
  for (const category of CATEGORY_DEFINITIONS) {
    const values: { periodIndex: number; plannedPct: number }[] = [];
    let total = 0;
    for (let periodIndex = 1; periodIndex <= 24; periodIndex++) {
      const value = numberAt(curveSheet, category.curveRow, periodIndex + 5);
      if (value === "invalid") {
        errors.push({
          row: category.curveRow,
          column: columnLetter(periodIndex + 5),
          message: `KURVA-S: ${category.description} has an invalid planned value.`,
        });
        continue;
      }
      if (typeof value === "number" && value < 0) {
        errors.push({
          row: category.curveRow,
          column: columnLetter(periodIndex + 5),
          message: `KURVA-S: ${category.description} planned progress cannot be negative.`,
        });
        continue;
      }
      if (typeof value === "number" && value !== 0) {
        values.push({ periodIndex, plannedPct: value });
        total += value;
      }
    }
    if (total <= 0) {
      errors.push({
        row: category.curveRow,
        column: null,
        message: `KURVA-S: ${category.description} has no planned distribution.`,
      });
      continue;
    }
    result.set(
      category.key,
      values.map((value) => ({ ...value, plannedPct: (value.plannedPct / total) * 100 })),
    );
  }
  return result;
}

function parseDetailSheet(sheet: ExcelJS.Worksheet, config: DetailLayout, errors: ImportError[]) {
  const leaves: ParsedLeaf[] = [];
  let currentCategory = config.fixedCategory ?? null;
  for (let row = 10; row <= sheet.rowCount; row++) {
    const description = firstText(sheet, row, config.descriptionColumns);
    const unit = textAt(sheet, row, config.unitColumn);
    const quantity = numberAt(sheet, row, config.quantityColumn);
    const unitRate = numberAt(sheet, row, config.unitRateColumn);
    const amount = numberAt(sheet, row, config.amountColumn);
    const priced =
      Boolean(description && unit) &&
      typeof quantity === "number" &&
      typeof unitRate === "number" &&
      typeof amount === "number";

    if (!priced) {
      const resemblesLine =
        Boolean(unit) ||
        (amount !== null && (quantity !== null || unitRate !== null));
      const pricingText = normalized(
        [
          config.unitColumn,
          config.quantityColumn,
          config.unitRateColumn,
          config.amountColumn,
        ]
          .map((column) => textAt(sheet, row, column))
          .filter(Boolean)
          .join(" "),
      );
      const intentionallyUnpriced =
        /\b(TAKEOUT|BY MEP|BY CIVIL|BY OWNER|EXISTING)\b/.test(pricingText) ||
        /^(SUB TOTAL|TOTAL|JUMLAH)\b/.test(normalized(description));
      if (resemblesLine && !intentionallyUnpriced) {
        errors.push({
          row,
          column: null,
          message: `${sheet.name}: priced row needs a description, unit, contractor quantity, unit rate, and amount.`,
        });
      }
      const heading = headingText(sheet, row, config.headingColumns);
      const match = config.headingCategories?.find((candidate) => candidate.pattern.test(heading));
      if (match) currentCategory = match.key;
      continue;
    }

    if (!currentCategory) {
      errors.push({
        row,
        column: null,
        message: `${sheet.name}: priced row could not be assigned to an S-curve category.`,
      });
      continue;
    }
    if (quantity < 0 || unitRate < 0 || amount < 0) {
      errors.push({
        row,
        column: null,
        message: `${sheet.name}: quantity, unit rate, and amount cannot be negative.`,
      });
      continue;
    }
    const tolerance = Math.max(0.01, Math.abs(amount) * 0.005);
    if (Math.abs(quantity * unitRate - amount) > tolerance) {
      errors.push({
        row,
        column: columnLetter(config.amountColumn),
        message: `${sheet.name}: amount does not match contractor quantity x unit rate.`,
      });
      continue;
    }

    const previousQuantity = numberAt(sheet, row, config.previousQuantityColumn);
    const previousPercent = numberAt(sheet, row, config.previousPercentColumn);
    const currentQuantity = numberAt(sheet, row, config.currentQuantityColumn);
    const currentPercent = numberAt(sheet, row, config.currentPercentColumn);
    for (const [column, value] of [
      [config.previousQuantityColumn, previousQuantity],
      [config.previousPercentColumn, previousPercent],
      [config.currentQuantityColumn, currentQuantity],
      [config.currentPercentColumn, currentPercent],
    ] as const) {
      if (value === "invalid") {
        errors.push({
          row,
          column: columnLetter(column),
          message: `${sheet.name}: progress value must be numeric.`,
        });
      }
    }
    if (
      typeof previousQuantity === "number" &&
      typeof currentQuantity === "number" &&
      currentQuantity + 0.000001 < previousQuantity
    ) {
      errors.push({
        row,
        column: columnLetter(config.currentQuantityColumn),
        message: `${sheet.name}: cumulative progress quantity decreases from the previous period.`,
      });
    }
    if (
      typeof previousPercent === "number" &&
      typeof currentPercent === "number" &&
      currentPercent + 0.000001 < previousPercent
    ) {
      errors.push({
        row,
        column: columnLetter(config.currentPercentColumn),
        message: `${sheet.name}: cumulative progress percentage decreases from the previous period.`,
      });
    }
    leaves.push({
      category: currentCategory,
      sheetName: sheet.name,
      sourceRow: row,
      description,
      unit,
      quantity,
      unitRate,
      amount,
      previousQuantity: typeof previousQuantity === "number" ? previousQuantity : null,
      previousPercent: typeof previousPercent === "number" ? previousPercent : null,
      currentQuantity: typeof currentQuantity === "number" ? currentQuantity : null,
      currentPercent: typeof currentPercent === "number" ? currentPercent : null,
    });
  }
  return leaves;
}

function progressValue(
  leaf: ParsedLeaf,
  periodIndex: number,
  cumulativeQuantity: number | null,
  sourcePercent: number | null,
  sourceColumn: number,
  errors: ImportError[],
): Omit<WeeklyItemProgress, "row"> | null {
  if (cumulativeQuantity === null && sourcePercent === null) return null;
  if (cumulativeQuantity === null || sourcePercent === null) {
    errors.push({
      row: leaf.sourceRow,
      column: columnLetter(sourceColumn),
      message: `${leaf.sheetName}: cumulative quantity and percentage must both be present.`,
    });
    return null;
  }
  if (cumulativeQuantity < 0 || sourcePercent < 0 || sourcePercent > 1) {
    errors.push({
      row: leaf.sourceRow,
      column: columnLetter(sourceColumn),
      message: `${leaf.sheetName}: cumulative progress must be between 0% and 100% and cannot have a negative quantity.`,
    });
    return null;
  }
  const pctComplete = leaf.quantity === 0 ? 0 : Math.min(100, Math.max(0, (cumulativeQuantity / leaf.quantity) * 100));
  const sourcePct = sourcePercent * 100;
  if (Math.abs(pctComplete - sourcePct) > 0.02) {
    errors.push({
      row: leaf.sourceRow,
      column: columnLetter(sourceColumn),
      message: `${leaf.sheetName}: cumulative quantity does not match the source progress percentage.`,
    });
    return null;
  }
  return {
    periodIndex,
    cumulativeQuantity,
    pctComplete,
    sourceSheetName: leaf.sheetName,
    sourceRow: leaf.sourceRow,
    sourceColumn,
    sourceValue: String(cumulativeQuantity),
  };
}

export function parseWeeklyProgressWorkbook(
  workbook: ExcelJS.Workbook,
  curveSheet: ExcelJS.Worksheet,
  aggregateCurrentPercent: number,
  currentPeriodIndex: number,
  aggregatePreviousPercent: number | null,
): WeeklyProgressParse | null {
  if (!isWeeklyProgressWorkbook(workbook, curveSheet)) return null;
  if (currentPeriodIndex < 2 || currentPeriodIndex > 24) return null;

  const errors: ImportError[] = [];
  const plans = categoryPlans(curveSheet, errors);
  const leaves = DETAIL_LAYOUTS.flatMap((config) => {
    const sheet = workbook.getWorksheet(config.sheetName);
    return sheet ? parseDetailSheet(sheet, config, errors) : [];
  });
  const sourceTotalAmount = leaves.reduce((total, leaf) => total + leaf.amount, 0);
  const persistedAmount = (leaf: ParsedLeaf) =>
    Number(leaf.quantity.toFixed(BOQ_NUMERIC_SCALE)) *
    Number(leaf.unitRate.toFixed(BOQ_NUMERIC_SCALE));
  const totalAmount = leaves.reduce((total, leaf) => total + persistedAmount(leaf), 0);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    errors.push({
      row: 1,
      column: null,
      message: "Detail sheets must produce a positive stored contract total.",
    });
  }
  const expectedSubtotal = recapSubtotal(workbook);
  if (expectedSubtotal === null || Math.abs(expectedSubtotal - sourceTotalAmount) > 0.02) {
    errors.push({
      row: 1,
      column: null,
      message: `REKAP TOTAL: detail sheets total ${sourceTotalAmount.toFixed(2)}, not the reported subtotal ${expectedSubtotal?.toFixed(2) ?? "(missing)"}.`,
    });
  }
  if (expectedSubtotal !== null && Math.abs(expectedSubtotal - totalAmount) > 0.02) {
    errors.push({
      row: 1,
      column: null,
      message: `REKAP TOTAL: stored quantity and unit-rate precision produces ${totalAmount.toFixed(2)}, not the reported subtotal ${expectedSubtotal.toFixed(2)}.`,
    });
  }

  const byCategory = new Map<CategoryKey, ParsedLeaf[]>();
  for (const leaf of leaves) {
    const categoryLeaves = byCategory.get(leaf.category) ?? [];
    categoryLeaves.push(leaf);
    byCategory.set(leaf.category, categoryLeaves);
  }
  for (const category of CATEGORY_DEFINITIONS) {
    if ((byCategory.get(category.key)?.length ?? 0) === 0) {
      errors.push({
        row: category.curveRow,
        column: null,
        message: `KURVA-S: ${category.description} has no priced detail rows.`,
      });
    }
  }

  const rows: ParsedRow[] = [];
  const itemProgress: WeeklyItemProgress[] = [];
  const rowSources = new Map<number, { sheetName: string; sourceRow: number }>();
  const latestByRow = new Map<number, number>();
  let virtualRow = 0;
  let previousEntryCount = 0;
  let currentEntryCount = 0;

  for (const category of CATEGORY_DEFINITIONS) {
    virtualRow++;
    rows.push({
      row: virtualRow,
      code: category.key,
      description: category.description,
      parentCode: null,
      unit: null,
      quantity: null,
      unitRate: null,
      weight: null,
      start: null,
      finish: null,
      cells: null,
    });
    rowSources.set(virtualRow, { sheetName: "KURVA-S", sourceRow: category.curveRow });
    const categoryLeaves = byCategory.get(category.key) ?? [];
    for (const [leafIndex, leaf] of categoryLeaves.entries()) {
      virtualRow++;
      const cells = plans.get(category.key) ?? null;
      const indexes = cells?.map((cell) => cell.periodIndex) ?? [];
      rows.push({
        row: virtualRow,
        code: String(leafIndex + 1).padStart(3, "0"),
        description: leaf.description,
        parentCode: category.key,
        unit: leaf.unit,
        quantity: leaf.quantity,
        unitRate: leaf.unitRate,
        weight: null,
        start: indexes.length > 0 ? Math.min(...indexes) : null,
        finish: indexes.length > 0 ? Math.max(...indexes) : null,
        cells,
      });
      rowSources.set(virtualRow, { sheetName: leaf.sheetName, sourceRow: leaf.sourceRow });

      const config = DETAIL_LAYOUTS.find((candidate) => candidate.sheetName === leaf.sheetName)!;
      const previous = progressValue(
        leaf,
        currentPeriodIndex - 1,
        leaf.previousQuantity,
        leaf.previousPercent,
        config.previousQuantityColumn,
        errors,
      );
      if (previous) {
        previousEntryCount++;
        latestByRow.set(virtualRow, previous.pctComplete);
        itemProgress.push({ row: virtualRow, ...previous });
      }
      const current = progressValue(
        leaf,
        currentPeriodIndex,
        leaf.currentQuantity,
        leaf.currentPercent,
        config.currentQuantityColumn,
        errors,
      );
      if (current) {
        currentEntryCount++;
        latestByRow.set(virtualRow, current.pctComplete);
        itemProgress.push({ row: virtualRow, ...current });
      }
    }
  }

  const amountByRow = new Map<number, number>();
  for (const row of rows) {
    if (row.parentCode !== null) {
      amountByRow.set(
        row.row,
        Number((row.quantity ?? 0).toFixed(BOQ_NUMERIC_SCALE)) *
          Number((row.unitRate ?? 0).toFixed(BOQ_NUMERIC_SCALE)),
      );
    }
  }
  const previousByRow = new Map<number, number>();
  for (const entry of itemProgress) {
    if (entry.periodIndex === currentPeriodIndex - 1) {
      previousByRow.set(entry.row, entry.pctComplete);
    }
  }
  const aggregate = (values: Map<number, number>) => {
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;
    return [...amountByRow].reduce(
      (total, [row, amount]) => total + (amount / totalAmount) * (values.get(row) ?? 0),
      0,
    );
  };
  const itemizedPreviousPercent = aggregate(previousByRow);
  const itemizedCurrentPercent = aggregate(latestByRow);
  if (aggregatePreviousPercent === null && previousEntryCount > 0) {
    errors.push({
      row: 1,
      column: null,
      message: `KURVA-S: aggregate progress for period ${currentPeriodIndex - 1} is missing.`,
    });
  } else if (
    aggregatePreviousPercent !== null &&
    Math.abs(itemizedPreviousPercent - aggregatePreviousPercent) > 0.01
  ) {
    errors.push({
      row: 1,
      column: null,
      message: `KURVA-S: itemized progress for period ${currentPeriodIndex - 1} is ${itemizedPreviousPercent.toFixed(4)}%, not the aggregate ${aggregatePreviousPercent.toFixed(4)}%.`,
    });
  }
  const confirmationRequired = Math.abs(itemizedCurrentPercent - aggregateCurrentPercent) > 0.01;
  const clientSheet = workbook.getWorksheet(DETAIL_SHEETS[0]);

  return {
    plan: {
      version: 1,
      detailSheetCount: DETAIL_SHEETS.length,
      categoryCount: CATEGORY_DEFINITIONS.length,
      previousPeriodIndex: currentPeriodIndex - 1,
      currentPeriodIndex,
    },
    rows,
    itemProgress,
    rowSources,
    preview: {
      detailSheetCount: DETAIL_SHEETS.length,
      categoryCount: CATEGORY_DEFINITIONS.length,
      previousPeriodIndex: currentPeriodIndex - 1,
      currentPeriodIndex,
      previousEntryCount,
      currentEntryCount,
      itemizedPreviousPercent,
      itemizedCurrentPercent,
      aggregatePreviousPercent,
      aggregateCurrentPercent,
      confirmationRequired,
    },
    totalAmount,
    client: clientSheet ? textAt(clientSheet, 4, 1) || textAt(clientSheet, 4, 2) || null : null,
    errors,
  };
}
