/**
 * Formatting shared by every spreadsheet this app hands out.
 *
 * Split out of project-export.ts when the per-project workbook arrived: two
 * copies of the rupiah format is exactly the kind of thing that gets fixed in
 * one file and silently left wrong in the other, and a portfolio export whose
 * money column disagrees with the project export's is worse than either being
 * wrong on its own.
 *
 * Deliberately holds no exceljs import, type-only or otherwise. It is imported
 * eagerly by the modules below it; anything exceljs-shaped in here would put
 * that package back in a boot graph, which is the failure documented at length
 * in project-export.ts and apps/server/src/index.ts.
 */

/** Rupiah, and left numeric so Excel can still sum the column. */
export const MONEY_FORMAT = '"Rp"#,##0';
export const PERCENT_FORMAT = "0.0%";
export const DATE_FORMAT = "yyyy-mm-dd";

/**
 * `date` columns arrive as "YYYY-MM-DD". Parsed at UTC midnight so the day
 * cannot drift by one — the same rule the calendar and the formatters use.
 */
export function toExcelDate(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

/** Today, used by collection exports whose contents can change between downloads. */
export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

/** Produces a readable filename that is valid on Windows, macOS, and Linux. */
export function projectWorkbookFilename(name: string, code: string) {
  const stem = `${name.trim()}-${code.trim()}`
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);
  return `${stem || "project"}.xlsx`;
}

export const PROJECT_STATUS_LABELS = {
  en: {
    planning: "Planning",
    active: "Active",
    on_hold: "On hold",
    completed: "Completed",
    cancelled: "Cancelled",
  },
  id: {
    planning: "Perencanaan",
    active: "Aktif",
    on_hold: "Ditunda",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  },
} as const;

export type Locale = keyof typeof PROJECT_STATUS_LABELS;
