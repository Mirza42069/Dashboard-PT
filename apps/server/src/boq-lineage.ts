import type { ParsedRow } from "./boq-import-parse";

export type RevisionSourceItem = {
  id: string;
  parentId: string | null;
  code: string;
  description: string;
  lineageId: string;
  progressMode: "by_quantity" | "by_percent";
};

const normalizeDescription = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Matches imported rows to stable identities by their unambiguous WBS path. */
export function importedLineages(
  rows: ParsedRow[],
  sourceItems: RevisionSourceItem[],
  explicitCodes = false,
): Map<number, string> {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const rowByCode = new Map(
    rows.filter((row) => row.parentCode === null).map((row) => [row.code, row]),
  );
  const lineageByPath = new Map<string, string | null>();
  for (const item of sourceItems) {
    const parent = item.parentId ? sourceById.get(item.parentId) : null;
    if (item.parentId && !parent) continue;
    const parentIdentity = parent
      ? `${parent.code}${explicitCodes ? "" : `\0${normalizeDescription(parent.description)}`}`
      : "";
    const path = `${parentIdentity}\0${item.code}${
      explicitCodes ? "" : `\0${normalizeDescription(item.description)}`
    }`;
    lineageByPath.set(path, lineageByPath.has(path) ? null : item.lineageId);
  }

  return new Map(
    rows.flatMap((row) => {
      const parent = row.parentCode ? rowByCode.get(row.parentCode) : null;
      const parentIdentity = parent
        ? `${parent.code}${explicitCodes ? "" : `\0${normalizeDescription(parent.description)}`}`
        : "";
      const lineageId = lineageByPath.get(`${parentIdentity}\0${row.code}${
        explicitCodes ? "" : `\0${normalizeDescription(row.description)}`
      }`);
      return lineageId ? [[row.row, lineageId] as const] : [];
    }),
  );
}
