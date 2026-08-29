import {
  MAX_AI_PDF_BYTES,
  MAX_AI_WORKBOOK_BYTES,
} from "@DashboardV2/api/lib/workbook-limits";
import { del, get, head, list } from "@vercel/blob";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";
const TEMPORARY_PREFIX = "temporary-workbooks/";
const EXPIRY_MS = 60 * 60 * 1000;
const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;
const PENDING_AI_CHARGE_TIMEOUT_MS = 60 * 60 * 1000;

export function maximumTemporaryWorkbookBytes(pathname: string) {
  return pathname.toLowerCase().endsWith(".pdf")
    ? MAX_AI_PDF_BYTES
    : MAX_AI_WORKBOOK_BYTES;
}

export class TemporaryWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemporaryWorkbookError";
  }
}

type TemporaryWorkbookStorage = {
  head: (pathname: string) => Promise<{
    size: number;
    contentType: string;
    contentDisposition: string;
  }>;
  get: (pathname: string) => Promise<
    | { statusCode: 200; stream: ReadableStream<Uint8Array> }
    | { statusCode: number; stream: null }
    | null
  >;
  delete: (pathname: string) => Promise<void>;
};

const blobStorage: TemporaryWorkbookStorage = {
  head: (pathname) => head(pathname),
  get: (pathname) => get(pathname, { access: "private", useCache: false }),
  delete: (pathname) => del(pathname),
};

async function claimTemporaryWorkbook(pathname: string) {
  const [{ db }, { temporaryWorkbookClaim }] = await Promise.all([
    import("@DashboardV2/db"),
    import("@DashboardV2/db/schema"),
  ]);
  const [claimed] = await db
    .insert(temporaryWorkbookClaim)
    .values({ pathname })
    .onConflictDoNothing()
    .returning({ pathname: temporaryWorkbookClaim.pathname });
  return Boolean(claimed);
}

export function temporaryWorkbookPrefix(projectId: string) {
  return `${TEMPORARY_PREFIX}${projectId}/`;
}

export function assertTemporaryWorkbookPath(pathname: string, projectId: string) {
  const extension = pathname.toLowerCase().match(/\.(xlsx|pdf)$/)?.[1];
  if (
    !pathname.startsWith(temporaryWorkbookPrefix(projectId)) ||
    !extension ||
    pathname.includes("..")
  ) {
    throw new TemporaryWorkbookError("The temporary workbook reference is invalid.");
  }
}

async function deleteWithRetry(pathname: string, storage: TemporaryWorkbookStorage) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await storage.delete(pathname);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw new TemporaryWorkbookError(
    `The workbook was processed, but its temporary upload could not be deleted: ${lastError instanceof Error ? lastError.message : "unknown storage error"}`,
  );
}

/**
 * A workbook is a one-use object. It is removed even when validation or the
 * caller fails, so no application path can turn this staging area into file
 * storage.
 */
export async function consumeTemporaryWorkbook<T>(input: {
  pathname: string;
  projectId: string;
  run: (workbook: {
    bytes: Uint8Array;
    filename: string;
    sourceKind: "xlsx" | "pdf";
  }) => Promise<T>;
  /** Test seam; production always uses the private Blob store. */
  storage?: TemporaryWorkbookStorage;
  /** Test seam; production uses the durable database claim. */
  claim?: (pathname: string) => Promise<boolean>;
}) {
  assertTemporaryWorkbookPath(input.pathname, input.projectId);
  if (!(await (input.claim ?? claimTemporaryWorkbook)(input.pathname))) {
    throw new TemporaryWorkbookError("The temporary workbook has already been consumed.");
  }
  const storage = input.storage ?? blobStorage;
  let outcome: T | undefined;
  let processingError: unknown;
  let deleted = false;

  try {
    const metadata = await storage.head(input.pathname);
    const sourceKind = input.pathname.toLowerCase().endsWith(".pdf") ? "pdf" : "xlsx";
    if (metadata.size === 0) throw new TemporaryWorkbookError("The workbook is empty.");
    const maximumBytes = maximumTemporaryWorkbookBytes(input.pathname);
    if (metadata.size > maximumBytes) {
      throw new TemporaryWorkbookError(
        sourceKind === "pdf"
          ? "The PDF exceeds the 50 MB upload limit."
          : "The workbook exceeds the 50 MB upload limit.",
      );
    }
    const expectedContentType = sourceKind === "pdf" ? PDF_CONTENT_TYPE : XLSX_CONTENT_TYPE;
    if (metadata.contentType !== expectedContentType) {
      throw new TemporaryWorkbookError("The upload type does not match its file extension.");
    }

    const downloaded = await storage.get(input.pathname);
    if (!downloaded || downloaded.statusCode !== 200 || !downloaded.stream) {
      throw new TemporaryWorkbookError("The temporary workbook could not be read.");
    }
    const bytes = new Uint8Array(await new Response(downloaded.stream).arrayBuffer());
    if (bytes.byteLength !== metadata.size) {
      throw new TemporaryWorkbookError("The temporary workbook download was incomplete.");
    }
    const matchesDeclaredType =
      sourceKind === "pdf"
        ? new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-"
        : bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!matchesDeclaredType) {
      throw new TemporaryWorkbookError("The upload contents do not match its file extension.");
    }
    const filename =
      metadata.contentDisposition.match(/filename="([^"]+)"/)?.[1] ??
      (sourceKind === "pdf" ? "document.pdf" : "workbook.xlsx");
    // Delete before calling application code. The bytes are already private in
    // this invocation, and no irreversible database write should happen while
    // a recoverable storage copy still exists.
    await deleteWithRetry(input.pathname, storage);
    deleted = true;
    outcome = await input.run({ bytes, filename, sourceKind });
  } catch (error) {
    processingError = error;
  }

  if (!deleted) {
    try {
      await deleteWithRetry(input.pathname, storage);
      deleted = true;
    } catch (deletionError) {
      if (processingError) {
        throw new AggregateError([processingError, deletionError], "Workbook processing and deletion failed.");
      }
      throw deletionError;
    }
  }

  if (processingError) throw processingError;
  return outcome as T;
}

export async function discardTemporaryWorkbook(pathname: string, projectId: string) {
  assertTemporaryWorkbookPath(pathname, projectId);
  if (!(await claimTemporaryWorkbook(pathname))) return;
  await deleteWithRetry(pathname, blobStorage);
}

/** Deletes uploads abandoned before the one-use processing request arrived. */
export async function purgeExpiredTemporaryWorkbooks(now = Date.now()) {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({ prefix: TEMPORARY_PREFIX, cursor, limit: 1000 });
    const expired = page.blobs.filter((blob) => now - blob.uploadedAt.getTime() >= EXPIRY_MS);
    if (expired.length > 0) {
      await del(expired.map((blob) => blob.pathname));
      deleted += expired.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const [{ db }, { aiCreditRefund, temporaryWorkbookClaim }] = await Promise.all([
    import("@DashboardV2/db"),
    import("@DashboardV2/db/schema"),
  ]);
  const { lt, sql } = await import("drizzle-orm");
  await db
    .delete(temporaryWorkbookClaim)
    .where(lt(temporaryWorkbookClaim.claimedAt, new Date(now - CLAIM_RETENTION_MS)));
  await db.execute(sql`
    with stale as (
      update ai_credit_refund
      set status = 'refunded', settled_at = now()
      where status = 'pending'
        and created_at < ${new Date(now - PENDING_AI_CHARGE_TIMEOUT_MS)}
      returning user_id
    ), refunds as (
      select user_id, count(*)::integer as amount
      from stale
      group by user_id
    )
    update "user"
    set trial_ai_credits = "user".trial_ai_credits + refunds.amount
    from refunds
    where "user".id = refunds.user_id and "user".trial_ai_credits is not null
  `);
  await db
    .delete(aiCreditRefund)
    .where(lt(aiCreditRefund.createdAt, new Date(now - CLAIM_RETENTION_MS)));
  return deleted;
}

export { PDF_CONTENT_TYPE, XLSX_CONTENT_TYPE };
