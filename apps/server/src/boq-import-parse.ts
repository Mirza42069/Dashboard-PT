import { PLAN_TOLERANCE, validatePlanWindow } from "@DashboardV2/api/lib/schedule-plan";
import { inflateRawSync } from "node:zlib";
// Type-only for the reason given in project-export.ts: exceljs is CommonJS over
// a tree of dynamic requires that Vercel's bundler will not resolve at boot.
import type ExcelJS from "exceljs";

/**
 * Reading a bill of quantities out of somebody's spreadsheet, and deciding
 * whether it is fit to import.
 *
 * Deliberately free of any database import. Everything here is a pure function
 * over an ExcelJS worksheet, which is what lets the test suite run the real
 * reference workbook through it without a connection string — and what keeps
 * the *rules* about what a valid BoQ row is in one readable place, separate
 * from the mechanics of writing one.
 */

/** Matches the photo upload ceiling, and for the same reason: Vercel's 4.5 MB body limit. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 5_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_WORKBOOK_SHEETS = 20;
export const MAX_WORKBOOK_ROWS = 10_000;
export const MAX_WORKBOOK_COLUMNS = 1_000;
const MAX_WORKBOOK_CELLS = 250_000;

/** How far down a sheet to look for the header row before giving up. */
const HEADER_SEARCH_ROWS = 25;

/** Sample values shown under each column in the mapping step. */
const SAMPLE_ROWS = 3;

/** Guards against a mapped 200,000-row sheet becoming one insert. */
export const MAX_IMPORT_ROWS = 2000;

export const IMPORT_FIELDS = [
  "code",
  "description",
  "parent",
  "unit",
  "quantity",
  "unitRate",
  "amount",
  "weight",
  "start",
  "finish",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportMapping = {
  /** 1-based column numbers, as ExcelJS counts them. */
  fields: Partial<Record<ImportField, number>>;
  /** Optional per-period plan, one column per reporting period. */
  periodColumns?: { periodIndex: number; column: number }[];
};

export type ImportError = {
  /** Spreadsheet row number, so it can be found in the file the user still has open. */
  row: number;
  column: string | null;
  message: string;
};

/* ------------------------------------------------------------------ reading */

/**
 * One cell, normalised.
 *
 * Every branch here exists because the reference workbook has cells of that
 * shape. Most of its grid is `sharedFormula` objects whose `result` carries the
 * value; its date header rows are Dates hiding inside those results; and its
 * merged label cells report as `richText`. Reading `.value` naively gets you
 * "[object Object]" for the majority of a real schedule.
 */
type Cell =
  | { kind: "empty" }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "date"; value: string }
  | { kind: "error"; value: string };

export function readCell(raw: unknown): Cell {
  if (raw === null || raw === undefined || raw === "") return { kind: "empty" };
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { kind: "number", value: raw } : { kind: "error", value: "#NUM!" };
  }
  if (typeof raw === "boolean") return { kind: "string", value: raw ? "TRUE" : "FALSE" };
  if (raw instanceof Date) return { kind: "date", value: toIsoDate(raw) };

  if (typeof raw === "object") {
    const cell = raw as Record<string, unknown>;
    // A formula cell that Excel never evaluated has no result. Treated as empty
    // rather than as zero — an unevaluated cell is unknown, and guessing zero
    // is how an import silently prices a line at nothing.
    if ("result" in cell) return readCell(cell.result);
    if ("error" in cell) return { kind: "error", value: String(cell.error) };
    if ("richText" in cell) {
      const text = (cell.richText as { text: string }[]).map((part) => part.text).join("");
      return text.trim() === "" ? { kind: "empty" } : { kind: "string", value: text };
    }
    if ("text" in cell) {
      const text = String(cell.text);
      return text.trim() === "" ? { kind: "empty" } : { kind: "string", value: text };
    }
    if ("formula" in cell || "sharedFormula" in cell) return { kind: "empty" };
  }

  const text = String(raw);
  return text.trim() === "" ? { kind: "empty" } : { kind: "string", value: text };
}

/**
 * Excel serial dates come back as UTC midnight, so the UTC calendar day is the
 * date that was typed. Reading local components instead shifts every date by a
 * day for anyone west of Greenwich.
 */
function toIsoDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

const cellText = (cell: Cell): string =>
  cell.kind === "empty" ? "" : cell.kind === "number" ? String(cell.value) : cell.value;

/** Spreadsheet column letter for a 1-based index: 1 → A, 27 → AA. */
export function columnLetter(index: number): string {
  let letters = "";
  let remaining = index;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/**
 * Strict numeric parsing.
 *
 * `Number("")` is 0 and `Number(" ")` is 0, which is precisely the coercion
 * that turns a blank unit rate into a free line item. Only a real number, or a
 * string that is entirely numeric once grouping marks are removed, is accepted;
 * everything else is a row error rather than a silent zero.
 *
 * Both separator conventions are accepted because the app's own money format is
 * Indonesian (1.234,56) while the workbooks people receive are as often
 * Anglophone (1,234.56). Two rules resolve them:
 *
 * 1. A mark that appears more than once is a grouping separator. "150.508.306"
 *    cannot be a decimal point three times over, so it is 150,508,306 — which
 *    is exactly how the reference workbook writes its contract sums.
 * 2. When both marks appear once, the later one is the decimal point.
 *
 * A single separator with nothing to disambiguate it ("1.234") stays a decimal
 * point. That case is genuinely ambiguous and no heuristic settles it; it is
 * also rare, because a spreadsheet holding a real number hands over a number.
 */
export function parseNumber(cell: Cell): number | null | "invalid" {
  if (cell.kind === "empty") return null;
  if (cell.kind === "number") return cell.value;
  if (cell.kind !== "string") return "invalid";

  const trimmed = cell.value.trim().replace(/\s|%|Rp/gi, "");
  if (trimmed === "") return null;

  const dots = (trimmed.match(/\./g) ?? []).length;
  const commas = (trimmed.match(/,/g) ?? []).length;

  let normalised: string;
  if (dots > 0 && commas > 0) {
    normalised =
      trimmed.lastIndexOf(",") > trimmed.lastIndexOf(".")
        ? trimmed.replace(/\./g, "").replace(",", ".")
        : trimmed.replace(/,/g, "");
  } else if (dots > 1) {
    normalised = trimmed.replace(/\./g, "");
  } else if (commas > 1) {
    normalised = trimmed.replace(/,/g, "");
  } else {
    normalised = trimmed.replace(",", ".");
  }

  if (!/^-?\d*\.?\d+$/.test(normalised)) return "invalid";
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

/* ----------------------------------------------------------------- preview */

export type SheetPreview = {
  name: string;
  rowCount: number;
  /** Best guess; the user confirms or moves it. */
  headerRow: number;
  columns: { index: number; letter: string; header: string; samples: string[] }[];
};

export class WorkbookLimitError extends Error {
  override readonly name = "WorkbookLimitError";
}

function validateXlsxArchive(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new WorkbookLimitError("The upload is not a valid .xlsx archive.");
  if (endOffset + 22 + view.getUint16(endOffset + 20, true) !== bytes.byteLength) {
    throw new WorkbookLimitError("The workbook archive footer is malformed.");
  }
  if (view.getUint16(endOffset + 4, true) !== 0 || view.getUint16(endOffset + 6, true) !== 0) {
    throw new WorkbookLimitError("Multi-part .xlsx archives are not supported.");
  }

  const entryCount = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > MAX_XLSX_ENTRIES || centralOffset + centralSize > bytes.byteLength) {
    throw new WorkbookLimitError("The workbook archive is too large or malformed.");
  }

  let cursor = centralOffset;
  let totalDeclaredUncompressed = 0;
  let totalActualUncompressed = 0;
  for (let index = 0; index < entryCount; index++) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new WorkbookLimitError("The workbook archive directory is malformed.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    if ((flags & 1) !== 0) throw new WorkbookLimitError("Encrypted workbooks are not supported.");
    if (uncompressedSize > MAX_XLSX_ENTRY_BYTES) {
      throw new WorkbookLimitError("A workbook entry exceeds the extraction limit.");
    }
    totalDeclaredUncompressed += uncompressedSize;
    if (totalDeclaredUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new WorkbookLimitError("The workbook exceeds the extraction limit.");
    }
    if (
      localHeaderOffset + 30 > bytes.byteLength ||
      view.getUint32(localHeaderOffset, true) !== 0x04034b50
    ) {
      throw new WorkbookLimitError("The workbook archive contains a malformed entry.");
    }
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.byteLength) {
      throw new WorkbookLimitError("The workbook archive contains a truncated entry.");
    }
    const compressed = Buffer.from(
      bytes.buffer,
      bytes.byteOffset + dataOffset,
      compressedSize,
    );
    let actualSize: number;
    if (compressionMethod === 0) {
      actualSize = compressedSize;
    } else if (compressionMethod === 8) {
      try {
        actualSize = inflateRawSync(compressed, {
          maxOutputLength:
            Math.min(
              MAX_XLSX_ENTRY_BYTES,
              MAX_XLSX_UNCOMPRESSED_BYTES - totalActualUncompressed,
            ) + 1,
        }).byteLength;
      } catch {
        throw new WorkbookLimitError("The workbook exceeds the extraction limit or is malformed.");
      }
    } else {
      throw new WorkbookLimitError("The workbook uses an unsupported ZIP compression method.");
    }
    totalActualUncompressed += actualSize;
    if (
      actualSize > MAX_XLSX_ENTRY_BYTES ||
      totalActualUncompressed > MAX_XLSX_UNCOMPRESSED_BYTES
    ) {
      throw new WorkbookLimitError("The workbook exceeds the extraction limit.");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
    if (cursor > centralOffset + centralSize || cursor > bytes.byteLength) {
      throw new WorkbookLimitError("The workbook archive directory is malformed.");
    }
  }
}

export async function loadWorkbook(bytes: Uint8Array) {
  validateXlsxArchive(bytes);
  // Same lazy import as the exports next door — see the note at the top.
  const { default: excel } = (await import("exceljs")) as unknown as { default: typeof ExcelJS };
  const workbook = new excel.Workbook();
  // Cast: exceljs types this as Node's Buffer, and a Uint8Array is what a Hono
  // request body gives us. The reader only indexes it.
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  if (workbook.worksheets.length > MAX_WORKBOOK_SHEETS) {
    throw new WorkbookLimitError(`A workbook can contain at most ${MAX_WORKBOOK_SHEETS} sheets.`);
  }
  let populatedCells = 0;
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > MAX_WORKBOOK_ROWS || sheet.columnCount > MAX_WORKBOOK_COLUMNS) {
      throw new WorkbookLimitError(
        `Each sheet is limited to ${MAX_WORKBOOK_ROWS} rows and ${MAX_WORKBOOK_COLUMNS} columns.`,
      );
    }
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, () => {
        populatedCells++;
      });
    });
    if (populatedCells > MAX_WORKBOOK_CELLS) {
      throw new WorkbookLimitError(
        `A workbook can contain at most ${MAX_WORKBOOK_CELLS.toLocaleString("en-US")} populated cells.`,
      );
    }
  }
  return workbook;
}

/**
 * The header row is the one with the most filled text cells in the first
 * stretch of the sheet.
 *
 * Real schedules open with a title block and a merged month band before the
 * column names — the reference workbook does not name its columns until row 7 —
 * so assuming row 1 gets you a mapping step listing "(blank)" nine times.
 * Counting text cells finds the row that looks like headings, and the user can
 * still move it.
 */
function detectHeaderRow(sheet: ExcelJS.Worksheet): number {
  let best = 1;
  let bestScore = 0;
  const limit = Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);

  for (let rowNumber = 1; rowNumber <= limit; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    let score = 0;
    for (let column = 1; column <= sheet.columnCount; column++) {
      const cell = readCell(row.getCell(column).value);
      // Text only: a row of dates or figures is data, however full it is.
      if (cell.kind === "string" && cell.value.trim() !== "") score++;
    }
    if (score > bestScore) {
      best = rowNumber;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? best : 1;
}

export function describeSheet(sheet: ExcelJS.Worksheet, headerRow?: number): SheetPreview {
  const resolvedHeader = headerRow ?? detectHeaderRow(sheet);
  const header = sheet.getRow(resolvedHeader);
  const columns: SheetPreview["columns"] = [];

  for (let index = 1; index <= sheet.columnCount; index++) {
    const samples: string[] = [];
    for (
      let rowNumber = resolvedHeader + 1;
      rowNumber <= sheet.rowCount && samples.length < SAMPLE_ROWS;
      rowNumber++
    ) {
      const text = cellText(readCell(sheet.getRow(rowNumber).getCell(index).value));
      if (text.trim() !== "") samples.push(text.slice(0, 60));
    }

    const headerText = cellText(readCell(header.getCell(index).value)).trim();
    // An unnamed column with data under it still gets offered — schedules
    // routinely leave the code column's heading blank.
    if (headerText === "" && samples.length === 0) continue;

    columns.push({ index, letter: columnLetter(index), header: headerText, samples });
  }

  return {
    name: sheet.name,
    rowCount: sheet.rowCount,
    headerRow: resolvedHeader,
    columns,
  };
}

export async function previewWorkbook(bytes: Uint8Array): Promise<{ sheets: SheetPreview[] }> {
  const workbook = await loadWorkbook(bytes);
  return { sheets: workbook.worksheets.map((sheet) => describeSheet(sheet)) };
}

/* -------------------------------------------------------------- validation */

export type ParsedRow = {
  row: number;
  code: string;
  description: string;
  parentCode: string | null;
  unit: string | null;
  quantity: number | null;
  unitRate: number | null;
  weight: number | null;
  start: number | null;
  finish: number | null;
  /** Explicit per-period plan, when period columns were mapped. */
  cells: { periodIndex: number; plannedPct: number }[] | null;
};

export type ParseResult = { rows: ParsedRow[]; errors: ImportError[] };

export type PeriodRef = { periodIndex: number; startDate: string; endDate: string };

export type ParseOptions = {
  dataStartRow?: number;
  dataEndRow?: number;
  sectionRows?: number[];
  excludedRows?: number[];
  requirePricing?: boolean;
  parentAssignments?: { row: number; parentRow: number | null }[];
};

/**
 * Reads and checks every mapped row.
 *
 * Errors accumulate rather than throwing: someone with forty malformed rows
 * wants the list, not the first one forty times over.
 */
export function parseRows(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  mapping: ImportMapping,
  periods: PeriodRef[],
  options: ParseOptions = {},
): ParseResult {
  const errors: ImportError[] = [];
  const rows: ParsedRow[] = [];
  const { fields } = mapping;

  const at = (rowNumber: number, column: number | undefined) =>
    column === undefined ? ({ kind: "empty" } as Cell) : readCell(sheet.getRow(rowNumber).getCell(column).value);

  const periodIndexes = periods.map((period) => period.periodIndex);
  const fail = (row: number, field: ImportField | null, message: string) =>
    errors.push({
      row,
      column: field && fields[field] ? columnLetter(fields[field]) : null,
      message,
    });

  /** A period number, or a date resolved to the period containing it. */
  function resolvePeriod(rowNumber: number, field: "start" | "finish"): number | null | "invalid" {
    const cell = at(rowNumber, fields[field]);
    if (cell.kind === "empty") return null;

    if (cell.kind === "date") {
      const match = periods.find(
        (period) => period.startDate <= cell.value && cell.value <= period.endDate,
      );
      if (!match) {
        fail(rowNumber, field, `${cell.value} falls outside the project's reporting periods.`);
        return "invalid";
      }
      return match.periodIndex;
    }

    const parsed = parseNumber(cell);
    if (parsed === "invalid" || parsed === null || !Number.isInteger(parsed)) {
      fail(rowNumber, field, "Expected a period number or a date.");
      return "invalid";
    }
    if (!periodIndexes.includes(parsed)) {
      fail(
        rowNumber,
        field,
        `Period ${parsed} does not exist — this project has periods ${Math.min(...periodIndexes)} to ${Math.max(...periodIndexes)}.`,
      );
      return "invalid";
    }
    return parsed;
  }

  function numberField(rowNumber: number, field: ImportField, label: string): number | null | "invalid" {
    const parsed = parseNumber(at(rowNumber, fields[field]));
    if (parsed === "invalid") {
      fail(rowNumber, field, `${label} must be a number.`);
      return "invalid";
    }
    if (parsed !== null && parsed < 0) {
      fail(rowNumber, field, `${label} cannot be negative.`);
      return "invalid";
    }
    return parsed;
  }

  let autoCode = 0;
  let sectionNumber = 0;
  let currentSectionCode: string | null = null;
  const sectionRows = new Set(options.sectionRows ?? []);
  const excludedRows = new Set(options.excludedRows ?? []);
  const assignments = options.parentAssignments
    ? new Map(options.parentAssignments.map((assignment) => [assignment.row, assignment.parentRow]))
    : null;
  const firstRow = options.dataStartRow ?? headerRow + 1;
  const lastRow = Math.min(options.dataEndRow ?? sheet.rowCount, sheet.rowCount);
  const sectionCodeByRow = new Map<number, string>();
  for (const rowNumber of [...sectionRows].sort((a, b) => a - b)) {
    const mappedCode = cellText(at(rowNumber, fields.code)).trim();
    sectionCodeByRow.set(rowNumber, mappedCode || `S${sectionCodeByRow.size + 1}`);
  }

  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
    if (excludedRows.has(rowNumber)) continue;
    const description = cellText(at(rowNumber, fields.description)).trim();
    const codeText = cellText(at(rowNumber, fields.code)).trim();
    const parentText = cellText(at(rowNumber, fields.parent)).trim();

    // A blank line in the middle of a BoQ is spacing, but a row with a mapped
    // amount or schedule value and no description is malformed, not blank.
    const hasMappedValue = Object.values(fields).some(
      (column) => column !== undefined && at(rowNumber, column).kind !== "empty",
    );
    if (description === "" && codeText === "" && parentText === "" && !hasMappedValue) continue;

    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({
        row: rowNumber,
        column: null,
        message: `This sheet has more than ${MAX_IMPORT_ROWS} rows. Split it and import in parts.`,
      });
      break;
    }

    let rowFailed = false;

    if (description === "") {
      fail(rowNumber, "description", "Description is required.");
      rowFailed = true;
    } else if (description.length > 2_000) {
      fail(rowNumber, "description", "Description must not exceed 2,000 characters.");
      rowFailed = true;
    }
    if (fields.code !== undefined && codeText === "") {
      fail(rowNumber, "code", "BoQ code is required.");
      rowFailed = true;
    } else if (codeText.length > 200 || parentText.length > 200) {
      fail(rowNumber, fields.code !== undefined ? "code" : null, "BoQ codes must not exceed 200 characters.");
      rowFailed = true;
    }

    const isSection = sectionRows.has(rowNumber);
    if (isSection) {
      const carriesLineData = (
        ["amount", "quantity", "unitRate", "weight", "start", "finish"] as ImportField[]
      ).some(
        (field) => fields[field] !== undefined && at(rowNumber, fields[field]).kind !== "empty",
      );
      if (carriesLineData) {
        fail(rowNumber, null, "A section row cannot contain pricing, weight, or schedule values.");
        rowFailed = true;
      }
    }
    const quantity = isSection ? null : numberField(rowNumber, "quantity", "Quantity");
    const unitRate = isSection ? null : numberField(rowNumber, "unitRate", "Unit rate");
    const amount = isSection ? null : numberField(rowNumber, "amount", "Amount");
    const weight = numberField(rowNumber, "weight", "Weight");
    if (
      quantity === "invalid" ||
      unitRate === "invalid" ||
      amount === "invalid" ||
      weight === "invalid"
    ) {
      rowFailed = true;
    }
    if (
      amount !== "invalid" &&
      amount !== null &&
      quantity !== "invalid" &&
      quantity !== null &&
      unitRate !== "invalid" &&
      unitRate !== null
    ) {
      const calculated = quantity * unitRate;
      const tolerance = Math.max(0.01, Math.abs(amount) * 0.005);
      if (Math.abs(calculated - amount) > tolerance) {
        fail(rowNumber, "amount", "Amount does not match quantity × unit rate.");
        rowFailed = true;
      }
    }
    if (
      options.requirePricing &&
      !isSection &&
      amount !== "invalid" &&
      quantity !== "invalid" &&
      unitRate !== "invalid" &&
      amount === null &&
      (quantity === null || unitRate === null)
    ) {
      fail(rowNumber, null, "Map an amount, or both quantity and unit rate, for every BoQ line.");
      rowFailed = true;
    }

    if (weight !== "invalid" && weight !== null && weight > 100) {
      fail(rowNumber, "weight", "Weight cannot exceed 100%.");
      rowFailed = true;
    }

    const start = isSection ? null : resolvePeriod(rowNumber, "start");
    const finish = isSection ? null : resolvePeriod(rowNumber, "finish");
    if (start === "invalid" || finish === "invalid") rowFailed = true;

    if (start !== "invalid" && finish !== "invalid") {
      const hasStart = start !== null;
      const hasFinish = finish !== null;
      if (hasStart !== hasFinish) {
        fail(rowNumber, hasStart ? "finish" : "start", "A planning window needs both a start and a finish period.");
        rowFailed = true;
      } else if (hasStart && hasFinish) {
        const problem = validatePlanWindow(
          { startIndex: start as number, finishIndex: finish as number },
          periodIndexes,
        );
        if (problem?.kind === "finish_before_start") {
          fail(rowNumber, "finish", "The finish period cannot come before the start period.");
          rowFailed = true;
        }
      }
    }

    let cells: ParsedRow["cells"] = null;
    if (mapping.periodColumns && mapping.periodColumns.length > 0) {
      const explicit: { periodIndex: number; plannedPct: number }[] = [];
      let total = 0;
      for (const { periodIndex, column } of mapping.periodColumns) {
        const parsed = parseNumber(at(rowNumber, column));
        if (parsed === "invalid") {
          errors.push({
            row: rowNumber,
            column: columnLetter(column),
            message: "Planned percentage must be a number.",
          });
          rowFailed = true;
          continue;
        }
        if (parsed === null || parsed === 0) continue;
        explicit.push({ periodIndex, plannedPct: parsed });
        total += parsed;
      }
      if (explicit.length > 0) {
        if (Math.abs(total - 100) > PLAN_TOLERANCE) {
          errors.push({
            row: rowNumber,
            column: null,
            message: `The planned percentages on this row total ${total.toFixed(2)}%, not 100%.`,
          });
          rowFailed = true;
        }
        cells = explicit;
      }
    }

    if (rowFailed) continue;

    if (isSection) {
      sectionNumber++;
      currentSectionCode = sectionCodeByRow.get(rowNumber) ?? (codeText || `S${sectionNumber}`);
    } else {
      autoCode++;
    }
    const hasQuantityPrice =
      quantity !== "invalid" &&
      quantity !== null &&
      unitRate !== "invalid" &&
      unitRate !== null;
    const lumpSum = !hasQuantityPrice && amount !== "invalid" && amount !== null;
    let parentCode: string | null;
    if (isSection) {
      parentCode = null;
    } else if (assignments) {
      if (!assignments.has(rowNumber)) {
        fail(rowNumber, null, "Choose a parent section or Top level for this row.");
        continue;
      }
      const parentRow = assignments.get(rowNumber) ?? null;
      parentCode = parentRow === null ? null : (sectionCodeByRow.get(parentRow) ?? null);
      if (parentRow !== null && parentCode === null) {
        fail(rowNumber, null, `The selected parent row ${parentRow} is not a section.`);
        continue;
      }
    } else {
      parentCode = parentText || currentSectionCode;
    }
    rows.push({
      row: rowNumber,
      // An unmapped code column numbers the lines in sheet order. Codes are
      // identity within a section, not meaning, so inventing them is safe —
      // inventing a description or a quantity would not be.
      code: isSection
        ? currentSectionCode!
        : fields.code === undefined
          ? String(autoCode)
          : codeText,
      description,
      parentCode,
      unit: isSection ? null : cellText(at(rowNumber, fields.unit)).trim() || (lumpSum ? "LS" : null),
      quantity: isSection ? null : lumpSum ? 1 : (quantity as number | null),
      unitRate: isSection ? null : lumpSum ? amount : (unitRate as number | null),
      weight: isSection ? null : (weight as number | null),
      start: start as number | null,
      finish: finish as number | null,
      cells,
    });
  }

  errors.push(...checkStructure(rows, mapping));

  return { rows, errors };
}

/**
 * Hierarchy and uniqueness, which can only be judged once every row is read.
 *
 * The tree is two levels — sections and the lines under them — matching what
 * the BoQ grid renders and what `buildSections` assumes. A parent reference
 * that names another child, or names nothing in the file, is a broken hierarchy
 * and is reported as one rather than being flattened into a top-level line.
 */
function checkStructure(rows: ParsedRow[], mapping: ImportMapping): ImportError[] {
  const errors: ImportError[] = [];
  const topLevelByCode = new Map(
    rows.filter((row) => row.parentCode === null).map((row) => [row.code, row]),
  );
  const parentColumn = mapping.fields.parent ? columnLetter(mapping.fields.parent) : null;
  const codeColumn = mapping.fields.code ? columnLetter(mapping.fields.code) : null;

  for (const row of rows) {
    if (row.parentCode === null) continue;
    if (row.parentCode === row.code) {
      errors.push({ row: row.row, column: parentColumn, message: "A line cannot be its own section." });
      continue;
    }
    if (!topLevelByCode.has(row.parentCode)) {
      errors.push({
        row: row.row,
        column: parentColumn,
        message: `No section with code "${row.parentCode}" appears in this sheet.`,
      });
    }
  }

  for (const parentCode of new Set(rows.flatMap((row) => row.parentCode ?? []))) {
    const parent = topLevelByCode.get(parentCode);
    if (
      parent &&
      (parent.quantity !== null ||
        parent.unitRate !== null ||
        parent.weight !== null ||
        parent.start !== null ||
        parent.finish !== null ||
        parent.cells !== null)
    ) {
      errors.push({
        row: parent.row,
        column: null,
        message: "A section referenced by child rows cannot contain pricing, weight, or schedule values.",
      });
    }
  }

  // Codes are unique among siblings, which is the constraint the database
  // enforces — two lines called "1" under different sections are fine.
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.parentCode ?? ""}|${row.code}`;
    const first = seen.get(key);
    if (first !== undefined) {
      errors.push({
        row: row.row,
        column: codeColumn,
        message: `Code "${row.code}" is already used on row ${first}${row.parentCode ? ` under section "${row.parentCode}"` : ""}.`,
      });
      continue;
    }
    seen.set(key, row.row);
  }

  return errors;
}


/** The rejected rows as a spreadsheet-openable file. */
export function errorReportCsv(errors: ImportError[]): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = ["Row,Column,Problem"];
  for (const error of errors) {
    lines.push([error.row, escape(error.column ?? ""), escape(error.message)].join(","));
  }
  // Byte-order mark: without it Excel opens a UTF-8 CSV as the system codepage,
  // and every accented description in the error list arrives mangled.
  return `﻿${lines.join("\r\n")}\r\n`;
}
