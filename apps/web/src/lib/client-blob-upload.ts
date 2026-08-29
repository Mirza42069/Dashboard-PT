import type { PutBlobResult } from "@vercel/blob";
import { put } from "@vercel/blob/client";

type TokenResponse = {
  clientToken?: unknown;
  error?: unknown;
};

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function errorMessage(body: TokenResponse | null) {
  if (typeof body?.error === "string" && body.error.trim()) return body.error;
  if (
    body?.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }
  return "The upload could not be started. Sign in again and retry.";
}

/** Exchanges the signed-in browser session for a short-lived, path-scoped Blob token. */
export async function requestClientUploadToken(
  handleUploadUrl: string,
  pathname: string,
  clientPayload?: Record<string, unknown>,
  fetcher: Fetcher = fetch,
  multipart = false,
) {
  const response = await fetcher(handleUploadUrl, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: {
        pathname,
        clientPayload: clientPayload ? JSON.stringify(clientPayload) : null,
        multipart,
      },
    }),
  });

  let body: TokenResponse | null = null;
  try {
    body = (await response.json()) as TokenResponse;
  } catch {
    // The fallback below covers proxies returning HTML or an empty body.
  }

  if (!response.ok || typeof body?.clientToken !== "string") {
    throw new Error(errorMessage(body));
  }
  return body.clientToken;
}

export async function uploadPrivateBlob({
  pathname,
  file,
  handleUploadUrl,
  clientPayload,
  contentType,
  multipart = false,
}: {
  pathname: string;
  file: File;
  handleUploadUrl: string;
  clientPayload?: Record<string, unknown>;
  contentType: string;
  multipart?: boolean;
}): Promise<PutBlobResult> {
  const token = await requestClientUploadToken(
    handleUploadUrl,
    pathname,
    clientPayload,
    fetch,
    multipart,
  );
  return put(pathname, file, { access: "private", contentType, token, multipart });
}
