import type {
  DailyProgressPreview,
  ParsedDailyProgressItem,
  ParsedDailyProgressSnapshot,
} from "./project-daily-progress";
import type { PdfExtraction, PdfRowProgress } from "./project-pdf";

const ITEM_ROUNDING_TOLERANCE = 0.011;
const GRAND_TOTAL_ROUNDING_PER_ITEM = 0.005;

export type ParsedPdfDailyProgress = {
  snapshot: ParsedDailyProgressSnapshot | null;
  items: ParsedDailyProgressItem[];
  sourceSheetName: string;
  reportDate: string | null;
  cumulativePercent: number;
  preview: DailyProgressPreview;
  errors: { row: number; column: string | null; message: string }[];
};

type ReportingPeriod = {
  periodIndex: number;
  startDate: string;
  endDate: string;
};

export function resolvePdfProgressPeriod(
  sourceDate: string | null,
  confirmedDate: string | undefined,
  periods: ReportingPeriod[],
) {
  const reportDate = sourceDate ?? confirmedDate ?? null;
  return {
    reportDate,
    period:
      reportDate === null
        ? null
        : periods.find(
            (period) => reportDate >= period.startDate && reportDate <= period.endDate,
          ) ?? null,
  };
}

function differs(left: number, right: number, tolerance = ITEM_ROUNDING_TOLERANCE) {
  return Math.abs(left - right) > tolerance + Number.EPSILON;
}

function progressSourceValues(
  row: PdfExtraction["rows"][number],
  progress: PdfRowProgress,
): Record<string, string | number | null> {
  return {
    page: row.page,
    table: row.table,
    sourceRow: row.sourceRow,
    code: row.code,
    description: row.description,
    unit: row.unit,
    quantity: row.quantity,
    unitRate: row.unitRate,
    amount: row.amount,
    weight: row.weight,
    previousPercent: progress.previousPercent,
    previousWeighted: progress.previousWeighted,
    currentPercent: progress.currentPercent,
    currentWeighted: progress.currentWeighted,
    cumulativePercent: progress.cumulativePercent,
    cumulativeWeighted: progress.cumulativeWeighted,
    remainingPercent: progress.remainingPercent,
    remainingWeighted: progress.remainingWeighted,
    remark: progress.remark,
  };
}

/** Converts one signed detailed PDF report without attempting to match it to another BoQ. */
export function parsePdfDailyProgress(
  extraction: PdfExtraction,
): ParsedPdfDailyProgress | null {
  const report = extraction.progressReport;
  if (!report) return null;

  const errors: ParsedPdfDailyProgress["errors"] = [];
  const items: ParsedDailyProgressItem[] = [];
  for (const [rowIndex, row] of extraction.rows.entries()) {
    const progress = row.progress;
    if (!progress) continue;
    if (
      row.quantity === null ||
      row.unitRate === null ||
      row.amount === null ||
      row.weight === null
    ) {
      errors.push({
        row: row.sourceRow,
        column: null,
        message: `${row.description} is missing pricing or weight required for detailed progress.`,
      });
      continue;
    }

    const currentPercent = progress.currentPercent ?? 0;
    if (differs(progress.previousPercent + currentPercent, progress.cumulativePercent)) {
      errors.push({
        row: row.sourceRow,
        column: null,
        message: `${row.description} cumulative progress must equal previous plus current progress.`,
      });
    }
    if (differs(progress.cumulativePercent + progress.remainingPercent, 100)) {
      errors.push({
        row: row.sourceRow,
        column: null,
        message: `${row.description} cumulative and remaining progress must total 100%.`,
      });
    }

    const weightedChecks = [
      ["previous", progress.previousWeighted, progress.previousPercent],
      ...(progress.currentWeighted === null
        ? []
        : [["current", progress.currentWeighted, currentPercent] as const]),
      ["cumulative", progress.cumulativeWeighted, progress.cumulativePercent],
      ["remaining", progress.remainingWeighted, progress.remainingPercent],
    ] as const;
    for (const [label, weighted, percent] of weightedChecks) {
      if (differs(weighted, (percent / 100) * row.weight)) {
        errors.push({
          row: row.sourceRow,
          column: null,
          message: `${row.description} ${label} weighted progress does not match weight x completion.`,
        });
      }
    }

    items.push({
      // PDF sourceRow is scoped to a page/table. The persisted row must be
      // unique within the snapshot; the original locator remains in sourceValues.
      sourceRow: rowIndex + 1,
      code: row.code,
      description: row.description,
      sectionCode: progress.sectionCode,
      sectionDescription: progress.sectionDescription,
      parentCode: progress.parentCode,
      parentDescription: progress.parentDescription,
      unit: row.unit,
      quantity: row.quantity,
      unitRate: row.unitRate,
      amount: row.amount,
      weight: row.weight,
      previousPercent: progress.previousPercent,
      currentPercent: progress.currentPercent,
      cumulativePercent: progress.cumulativePercent,
      remainingPercent: progress.remainingPercent,
      previousWeighted: progress.previousWeighted,
      currentWeighted: progress.currentWeighted,
      cumulativeWeighted: progress.cumulativeWeighted,
      remainingWeighted: progress.remainingWeighted,
      remark: progress.remark,
      sourceValues: progressSourceValues(row, progress),
    });
  }

  const detailedTotal = items.reduce((total, item) => total + item.cumulativeWeighted, 0);
  const grandTotalTolerance = Math.max(
    0.02,
    items.length * GRAND_TOTAL_ROUNDING_PER_ITEM + 0.01,
  );
  if (differs(
    detailedTotal,
    report.grandTotal.cumulativePercent,
    grandTotalTolerance,
  )) {
    errors.push({
      row: report.grandTotal.sourceRow,
      column: null,
      message: `Detailed cumulative progress (${detailedTotal.toFixed(2)}%) does not reconcile with the reported grand total (${report.grandTotal.cumulativePercent.toFixed(2)}%).`,
    });
  }

  const sourceSheetName = `PDF page ${report.grandTotal.page}, ${report.grandTotal.table}`;
  const snapshot = report.reportDate === null
    ? null
    : {
        reportDate: report.reportDate,
        sourceSheetName,
        // The explicitly reported grand total is authoritative over rounded detail values.
        cumulativePercent: report.grandTotal.cumulativePercent,
        items,
      } satisfies ParsedDailyProgressSnapshot;
  const hasMovement = items.some((item) => (item.currentPercent ?? 0) > 0);
  return {
    snapshot,
    items,
    sourceSheetName,
    reportDate: report.reportDate,
    cumulativePercent: report.grandTotal.cumulativePercent,
    preview: {
      sheetCount: 1,
      itemCount: items.length,
      dates: report.reportDate === null ? [] : [report.reportDate],
      movementDates: report.reportDate !== null && hasMovement ? [report.reportDate] : [],
      latestCumulativePercent: report.grandTotal.cumulativePercent,
      ignoredSheets: [],
    },
    errors,
  };
}
