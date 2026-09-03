import type { Locale } from "./export-format";
import { todayStamp } from "./export-format";
import { buildProjectDetailWorkbook } from "./project-detail-export";
import { packageProjectWorkbooks, type ProjectWorkbookFile } from "./project-export-package";

/** Builds exactly the already-authorized projects supplied by the route. */
export async function buildSelectedProjectExport({
  projectIds,
  locale,
  includeTeam,
}: {
  projectIds: string[];
  locale: Locale;
  includeTeam: boolean;
}) {
  const files: ProjectWorkbookFile[] = [];
  // Deliberately sequential. Up to 100 detailed workbooks can be large, and
  // parallel ExcelJS builds multiply peak memory in a serverless process.
  for (const projectId of projectIds) {
    const built = await buildProjectDetailWorkbook({ projectId, locale, includeTeam });
    if (!built) return null;
    files.push(built);
  }

  return packageProjectWorkbooks(files, todayStamp());
}
