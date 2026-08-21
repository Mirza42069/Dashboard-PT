import { env } from "@DashboardV2/env/web";

import { getServerUrl } from "./server-url";

/**
 * Downloads a file from the API origin.
 *
 * Fetched rather than linked.
 *
 * A bare <a href> would be simpler, but the file lives on the API origin —
 * a different port in development — so a plain navigation depends on the
 * session cookie surviving a cross-site top-level GET, and an error would
 * replace the page with raw JSON. Fetching with credentials keeps the failure
 * in a caller-handled throw and lets a button show that it is working.
 *
 * Shared by the portfolio export and the per-project one. It is thirty lines
 * that each carry a browser quirk found the hard way; a second copy is a second
 * place for the Firefox fix below to be missing.
 *
 * @param path Server-relative, starting with "/".
 * @param fallbackName Used only if the response omits Content-Disposition.
 * @throws If the response is not ok. The caller owns the message.
 */
export async function downloadFromServer(path: string, fallbackName: string, errorMessage: string) {
  const response = await fetch(`${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}${path}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(errorMessage);

  const blob = await response.blob();
  // The server names the file; fall back only if the header is missing.
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];

  downloadBlob(blob, named ?? fallbackName);
}

/**
 * Hands a blob to the browser as a download.
 *
 * Split out of the fetch above so a file built on the client — a CSV of what
 * is already on screen, say — goes through the same two browser quirks rather
 * than around them.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // In the document and revoked a tick late, both on purpose: Firefox does
  // not start a download from a programmatic click on a detached anchor,
  // and revoking in the next statement races the download's own read of the
  // blob. Chrome tolerates either, which is how this passed review.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
