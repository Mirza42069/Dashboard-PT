import { expect, test } from "bun:test";

import {
  assertTemporaryWorkbookPath,
  consumeTemporaryWorkbook,
  maximumTemporaryWorkbookBytes,
  PDF_CONTENT_TYPE,
  TemporaryWorkbookError,
  XLSX_CONTENT_TYPE,
} from "./temporary-workbook";

const pathname = "temporary-workbooks/project-1/upload.xlsx";

test("temporary upload limits match each source contract", () => {
  expect(maximumTemporaryWorkbookBytes("temporary-workbooks/project-1/source.pdf")).toBe(
    49_999_999,
  );
  expect(maximumTemporaryWorkbookBytes(pathname)).toBe(50 * 1024 * 1024);
});

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
    storage: storage(new Uint8Array([0x50, 0x4b, 3]), deleted),
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
      storage: storage(new Uint8Array([0x50, 0x4b]), deleted),
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

test("temporary PDF uploads use their matching content type", async () => {
  const pdfPathname = "temporary-workbooks/project-1/upload.pdf";
  const deleted: string[] = [];
  const result = await consumeTemporaryWorkbook({
    pathname: pdfPathname,
    projectId: "project-1",
    storage: {
      ...storage(new TextEncoder().encode("%PDF-"), deleted),
      head: async () => ({
        size: 5,
        contentType: PDF_CONTENT_TYPE,
        contentDisposition: 'attachment; filename="progress.pdf"',
      }),
    },
    claim,
    run: async ({ sourceKind, filename }) => ({ sourceKind, filename }),
  });

  expect(result).toEqual({ sourceKind: "pdf", filename: "progress.pdf" });
  expect(deleted).toEqual([pdfPathname]);
});

test("rejects a PDF path uploaded with the workbook content type", async () => {
  const pdfPathname = "temporary-workbooks/project-1/upload.pdf";
  const deleted: string[] = [];
  await expect(
    consumeTemporaryWorkbook({
      pathname: pdfPathname,
      projectId: "project-1",
      storage: storage(new Uint8Array([0x50, 0x4b]), deleted),
      claim,
      run: async () => null,
    }),
  ).rejects.toThrow("does not match its file extension");
  expect(deleted).toEqual([pdfPathname]);
});

test("rejects PDF metadata when the downloaded bytes are an XLSX archive", async () => {
  const pdfPathname = "temporary-workbooks/project-1/upload.pdf";
  const deleted: string[] = [];
  await expect(
    consumeTemporaryWorkbook({
      pathname: pdfPathname,
      projectId: "project-1",
      storage: {
        ...storage(new Uint8Array([0x50, 0x4b]), deleted),
        head: async () => ({
          size: 2,
          contentType: PDF_CONTENT_TYPE,
          contentDisposition: 'attachment; filename="mislabeled.pdf"',
        }),
      },
      claim,
      run: async () => null,
    }),
  ).rejects.toThrow("contents do not match");
  expect(deleted).toEqual([pdfPathname]);
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

test("a PDF at the provider's 50 MB boundary is rejected before download", async () => {
  const pdfPathname = "temporary-workbooks/project-1/large.pdf";
  const deleted: string[] = [];
  await expect(
    consumeTemporaryWorkbook({
      pathname: pdfPathname,
      projectId: "project-1",
      storage: {
        head: async () => ({
          size: 50_000_000,
          contentType: PDF_CONTENT_TYPE,
          contentDisposition: 'attachment; filename="large.pdf"',
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
  expect(deleted).toEqual([pdfPathname]);
});

test("a temporary workbook can be claimed by only one concurrent consumer", async () => {
  const deleted: string[] = [];
  let claimed = false;
  let runs = 0;
  const consume = () =>
    consumeTemporaryWorkbook({
      pathname,
      projectId: "project-1",
      storage: storage(new Uint8Array([0x50, 0x4b]), deleted),
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
