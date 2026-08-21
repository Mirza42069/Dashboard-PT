import { expect, test } from "bun:test";

import {
  assertTemporaryWorkbookPath,
  consumeTemporaryWorkbook,
  TemporaryWorkbookError,
  XLSX_CONTENT_TYPE,
} from "./temporary-workbook";

const pathname = "temporary-workbooks/project-1/upload.xlsx";

function storage(bytes: Uint8Array, deleted: string[]) {
  return {
    head: async () => ({
      size: bytes.byteLength,
      contentType: XLSX_CONTENT_TYPE,
      contentDisposition: 'attachment; filename="progress.xlsx"',
    }),
    get: async () => ({
      statusCode: 200 as const,
      stream: new Response(bytes).body!,
    }),
    delete: async (value: string) => {
      deleted.push(value);
    },
  };
}

const claim = async () => true;

test("temporary workbooks are deleted after successful processing", async () => {
  const deleted: string[] = [];
  const result = await consumeTemporaryWorkbook({
    pathname,
    projectId: "project-1",
    storage: storage(new Uint8Array([1, 2, 3]), deleted),
    claim,
    run: async ({ bytes, filename }) => {
      expect(deleted).toEqual([pathname]);
      return { size: bytes.byteLength, filename };
    },
  });

  expect(result).toEqual({ size: 3, filename: "progress.xlsx" });
  expect(deleted).toEqual([pathname]);
});

test("temporary workbooks are deleted when processing fails", async () => {
  const deleted: string[] = [];
  await expect(
    consumeTemporaryWorkbook({
      pathname,
      projectId: "project-1",
      storage: storage(new Uint8Array([1]), deleted),
      claim,
      run: async () => {
        throw new Error("parser failed");
      },
    }),
  ).rejects.toThrow("parser failed");

  expect(deleted).toEqual([pathname]);
});

test("a temporary workbook cannot be consumed by another project", () => {
  expect(() => assertTemporaryWorkbookPath(pathname, "project-2")).toThrow(
    TemporaryWorkbookError,
  );
});

test("an oversized upload is rejected and still deleted", async () => {
  const deleted: string[] = [];
  await expect(
    consumeTemporaryWorkbook({
      pathname,
      projectId: "project-1",
      storage: {
        head: async () => ({
          size: 50 * 1024 * 1024 + 1,
          contentType: XLSX_CONTENT_TYPE,
          contentDisposition: 'attachment; filename="large.xlsx"',
        }),
        get: async () => {
          throw new Error("oversized files must not be downloaded");
        },
        delete: async (value) => {
          deleted.push(value);
        },
      },
      claim,
      run: async () => null,
    }),
  ).rejects.toThrow("50 MB upload limit");
  expect(deleted).toEqual([pathname]);
});

test("a temporary workbook can be claimed by only one concurrent consumer", async () => {
  const deleted: string[] = [];
  let claimed = false;
  let runs = 0;
  const consume = () =>
    consumeTemporaryWorkbook({
      pathname,
      projectId: "project-1",
      storage: storage(new Uint8Array([1]), deleted),
      claim: async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      },
      run: async () => ++runs,
    });

  const results = await Promise.allSettled([consume(), consume()]);

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(runs).toBe(1);
  expect(deleted).toEqual([pathname]);
});
