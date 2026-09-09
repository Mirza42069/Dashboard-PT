import { Data, Effect } from "effect";

import type { Locale } from "./export-format";
import { todayStamp } from "./export-format";
// Type-only: erased at runtime, so this module stays free of the database
// client and its environment validation. The route supplies the real builder.
import type { buildProjectDetailWorkbook } from "./project-detail-export";
import { packageProjectWorkbooks } from "./project-export-package";

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

/** Builds only the already-authorized projects supplied by the route. */
export function buildSelectedProjectExport(
  input: SelectedProjectExportInput,
  buildProjectDetail: ProjectDetailWorkbookBuilder,
): Effect.Effect<PackagedProjectExport, ProjectExportUnavailable | ProjectExportBuildFailed> {
  return Effect.gen(function* () {
    // Sequential builds keep up to 100 large workbooks from multiplying peak memory.
    const files = yield* Effect.forEach(input.projectIds, (projectId) =>
      Effect.gen(function* () {
        const built = yield* Effect.tryPromise({
          try: () => buildProjectDetail({
            projectId,
            locale: input.locale,
            includeTeam: input.includeTeam,
            dailyReportDate: input.dailyReportDate,
          }),
          catch: (cause) => new ProjectExportBuildFailed({ projectId, cause }),
        });
        if (built === null) return yield* Effect.fail(new ProjectExportUnavailable({ projectId }));
        return built;
      }),
    );
    return packageProjectWorkbooks(files, todayStamp());
  });
}
