import { brotliDecompressSync } from "node:zlib";

const MAGIC = new Uint8Array([0x50, 0x54, 0x57, 0x42]); // PTWB
const HEADER_BYTES = 8;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_WORKBOOK_BYTES = 4 * 1024 * 1024;

export const WORKBOOK_TRANSPORT_CONTENT_TYPE = "application/vnd.dashboard.workbook+br";

export class WorkbookTransportError extends Error {
  readonly kind = "workbook-transport";

  constructor(message: string) {
    super(message);
    this.name = "WorkbookTransportError";
  }
}

export function decodeWorkbookTransport(body: Uint8Array) {
  if (body.byteLength < HEADER_BYTES || MAGIC.some((byte, index) => body[index] !== byte)) {
    throw new WorkbookTransportError("The compressed workbook request is invalid.");
  }

  const metadataLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(4);
  if (metadataLength > MAX_METADATA_BYTES || HEADER_BYTES + metadataLength >= body.byteLength) {
    throw new WorkbookTransportError("The compressed workbook metadata is invalid.");
  }

  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(body.subarray(HEADER_BYTES, HEADER_BYTES + metadataLength)),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    metadata = parsed as Record<string, unknown>;
  } catch {
    throw new WorkbookTransportError("The compressed workbook metadata could not be read.");
  }

  try {
    const bytes = brotliDecompressSync(body.subarray(HEADER_BYTES + metadataLength), {
      maxOutputLength: MAX_WORKBOOK_BYTES + 1,
    });
    if (bytes.byteLength > MAX_WORKBOOK_BYTES) {
      throw new WorkbookTransportError("The workbook exceeds the 4 MB upload limit.");
    }
    return { bytes: new Uint8Array(bytes), metadata };
  } catch (error) {
    if (error instanceof WorkbookTransportError) throw error;
    throw new WorkbookTransportError("The compressed workbook could not be read.");
  }
}
