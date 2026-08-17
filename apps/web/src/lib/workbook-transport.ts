const MAGIC = new Uint8Array([0x50, 0x54, 0x57, 0x42]); // PTWB
const HEADER_BYTES = 8;

export const WORKBOOK_TRANSPORT_CONTENT_TYPE = "application/vnd.dashboard.workbook+br";

export async function createWorkbookTransport(
  file: File,
  metadata: Record<string, unknown> = {},
) {
  const [{ default: brotliPromise }, source] = await Promise.all([
    import("brotli-wasm"),
    file.arrayBuffer(),
  ]);
  const brotli = await brotliPromise;
  const metadataBytes = new TextEncoder().encode(
    JSON.stringify({ filename: file.name, ...metadata }),
  );
  const compressed = brotli.compress(new Uint8Array(source), { quality: 11 });
  const body = new Uint8Array(HEADER_BYTES + metadataBytes.byteLength + compressed.byteLength);

  body.set(MAGIC);
  new DataView(body.buffer).setUint32(4, metadataBytes.byteLength);
  body.set(metadataBytes, HEADER_BYTES);
  body.set(compressed, HEADER_BYTES + metadataBytes.byteLength);
  return body;
}
