import { expect, test } from "bun:test";
import { brotliCompressSync } from "node:zlib";

import { decodeWorkbookTransport, WorkbookTransportError } from "./workbook-transport";

function encode(bytes: Uint8Array, metadata: Record<string, unknown>) {
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const compressed = brotliCompressSync(bytes);
  const body = new Uint8Array(8 + metadataBytes.byteLength + compressed.byteLength);
  body.set([0x50, 0x54, 0x57, 0x42]);
  new DataView(body.buffer).setUint32(4, metadataBytes.byteLength);
  body.set(metadataBytes, 8);
  body.set(compressed, 8 + metadataBytes.byteLength);
  return body;
}

test("decodes a Brotli workbook envelope", () => {
  const workbook = new TextEncoder().encode("workbook bytes");
  const decoded = decodeWorkbookTransport(encode(workbook, { filename: "plan.xlsx" }));

  expect(decoded.metadata).toEqual({ filename: "plan.xlsx" });
  expect(decoded.bytes).toEqual(workbook);
});

test("rejects an invalid workbook envelope", () => {
  expect(() => decodeWorkbookTransport(new Uint8Array([1, 2, 3]))).toThrow(WorkbookTransportError);
});

test("bounds the decompressed workbook size", () => {
  const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
  expect(() => decodeWorkbookTransport(encode(oversized, {}))).toThrow(
    "The workbook exceeds the 4 MB upload limit.",
  );
});
