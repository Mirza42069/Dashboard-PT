export const MAX_AI_WORKBOOK_BYTES = 50 * 1024 * 1024;
// OpenAI file inputs must remain strictly below 50 decimal MB.
export const MAX_AI_PDF_BYTES = 50_000_000 - 1;
export const MAX_AI_PDF_PAGES = 25;
export const MAX_WORKBOOK_SHEETS = 100;

export const AI_WORKBOOK_SIZE_LABEL = "50 MB";
export const AI_PDF_SIZE_LABEL = "50 MB";
