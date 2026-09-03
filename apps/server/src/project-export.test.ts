import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { strFromU8, strToU8, unzipSync } from "fflate";

import {
  buildSelectedProjectExport,
  ProjectExportBuildFailed,
  ProjectExportUnavailable,
  type ProjectDetailWorkbookBuilder,
} from "./project-export";
import type { ProjectWorkbookFile } from "./project-export-package";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_CONTENT_TYPE = "application/zip";

function file(stem: string): ProjectWorkbookFile {
  return { filename: `${stem}.xlsx`, body: Uint8Array.from(strToU8(stem)) };
}

function builderWith(
  files: Record<string, ProjectWorkbookFile | null>,
): ProjectDetailWorkbookBuilder {
  return (input) => Promise.resolve(files[input.projectId] ?? null);
}

describe("the Effect project export pipeline", () => {
  test("one selection passes the workbook through as an xlsx", async () => {
    const result = await Effect.runPromise(
      buildSelectedProjectExport(
        { projectIds: ["a"], locale: "en", includeTeam: false },
        builderWith({ a: file("A") }),
      ),
    );

    expect(result).toMatchObject({
      filename: "A.xlsx",
      contentType: XLSX_CONTENT_TYPE,
      body: Uint8Array.from(strToU8("A")),
    });
  });

  test("several selections become a zip carrying every workbook", async () => {
    const result = await Effect.runPromise(
      buildSelectedProjectExport(
        { projectIds: ["a", "b"], locale: "id", includeTeam: false },
        builderWith({ a: file("A"), b: file("B") }),
      ),
    );

    expect(result.contentType).toBe(ZIP_CONTENT_TYPE);
    expect(result.filename).toMatch(/^projects-\d{4}-\d{2}-\d{2}\.zip$/);
    const members = unzipSync(result.body);
    expect(Object.keys(members).sort()).toEqual(["A.xlsx", "B.xlsx"]);
    expect(strFromU8(members["A.xlsx"]!)).toBe("A");
    expect(strFromU8(members["B.xlsx"]!)).toBe("B");
  });

  test("builds strictly in request order", async () => {
    const calls: string[] = [];
    const ordered: ProjectDetailWorkbookBuilder = (input) => {
      calls.push(input.projectId);
      return Promise.resolve(file(input.projectId.toUpperCase()));
    };

    await Effect.runPromise(
      buildSelectedProjectExport(
        { projectIds: ["b", "a", "c"], locale: "en", includeTeam: false },
        ordered,
      ),
    );

    expect(calls).toEqual(["b", "a", "c"]);
  });

  test("a missing project fails with the tagged unavailable error", async () => {
    const effect = buildSelectedProjectExport(
      { projectIds: ["a", "missing"], locale: "en", includeTeam: false },
      builderWith({ a: file("A") }),
    );

    const error = await Effect.runPromise(effect).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProjectExportUnavailable);
    expect(error).toMatchObject({ projectId: "missing" });
  });

  test("a builder failure keeps its cause on the tagged error", async () => {
    const cause = new Error("database vanished");
    const failing: ProjectDetailWorkbookBuilder = () => Promise.reject(cause);

    const error = await Effect.runPromise(
      buildSelectedProjectExport({ projectIds: ["a"], locale: "en", includeTeam: false }, failing),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProjectExportBuildFailed);
    expect(error).toMatchObject({ cause });
  });

  test("the report date and locale reach the workbook builder", async () => {
    const seen: unknown[] = [];
    const recording: ProjectDetailWorkbookBuilder = async (input) => {
      seen.push(input);
      return file("A");
    };

    await Effect.runPromise(
      buildSelectedProjectExport(
        {
          projectIds: ["a"],
          locale: "id",
          includeTeam: true,
          dailyReportDate: "2026-08-22",
        },
        recording,
      ),
    );

    expect(seen).toEqual([
      {
        projectId: "a",
        locale: "id",
        includeTeam: true,
        dailyReportDate: "2026-08-22",
      },
    ]);
  });
});
