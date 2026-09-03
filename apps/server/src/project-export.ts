import { Data, Effect } from "effect";

import type { Locale } from "./export-format";
import { todayStamp } from "./export-format";
// Type-only: erased at runtime, so this module stays free of the database
// client and its environment validation. The route supplies the real builder.
import type { buildProjectDetailWorkbook } from "./project-detail-export";
import { packageProjectWorkbooks, type ProjectWorkbookFile } from "./project-export-package";

/** The requested project resolved to no workbook — unknown, archived, or inaccessible. */
export class ProjectExportUnavailable extends Data.TaggedError("ProjectExportUnavailable")<{
  readonly projectId: string;
}> {}

/** The workbook build itself failed (database, ExcelJS, chart rendering). */
export class ProjectExportBuildFailed extends Data.TaggedError("ProjectExportBuildFailed")<{
  readonly projectId: string;
  readonly cause: unknown;
}> {}

export type SelectedProjectExportInput = {
  projectIds: string[];
  locale: Locale;
  includeTeam: boolean;
  dailyReportDate?: string;
};

export type PackagedProjectExport = {
  filename: string;
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
};

/** The already-authorized workbook builder the route wires in at call time. */
export type ProjectDetailWorkbookBuilder = typeof buildProjectDetailWorkbook;

/**
 * Builds exactly the already-authorized projects supplied by the route. One
 * selection is an XLSX; multiple selections are a ZIP containing one XLSX per
 * project.
 *
 * The typed error channel replaces the old null sentinel: the route maps
 * ProjectExportUnavailable to a 404 without confusing "one bad id" with "the
 * builder blew up", and authorization stays owned by the route — this function
 * is never handed an unrequested id.
 */
export const buildSelectedProjectExport = (
  input: SelectedProjectExportInput,
  buildProjectDetail: ProjectDetailWorkbookBuilder,
): Effect.Effect<PackagedProjectExport, ProjectExportUnavailable | ProjectExportBuildFailed> =>
  Effect.gen(function* () {
    // Deliberately sequential (concurrency: 1). Up to 100 detailed workbooks
    // can be large, and parallel ExcelJS builds multiply peak memory in a
    // serverless process.
    const files: ProjectWorkbookFile[] = yield* Effect.forEach(
      input.projectIds,
      (projectId) =>
        Effect.tryPromise({
          try: () =>
            buildProjectDetail({
              projectId,
              locale: input.locale,
              includeTeam: input.includeTeam,
              dailyReportDate: input.dailyReportDate,
            }),
          catch: (cause) => new ProjectExportBuildFailed({ projectId, cause }),
        }).pipe(
          Effect.flatMap((built) =>
            built === null
              ? Effect.fail(new ProjectExportUnavailable({ projectId }))
              : Effect.succeed(built),
          ),
        ),
      { concurrency: 1 },
    );

    return packageProjectWorkbooks(files, todayStamp());
  });
