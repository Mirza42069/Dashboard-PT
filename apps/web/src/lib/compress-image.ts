/**
 * Downscales a photo in the browser so it fits through the server's 4 MB
 * upload cap (itself dictated by Vercel's 4.5 MB serverless body limit).
 * Evidence and receipt photos need to be legible, not pixel-perfect: a
 * ~2000px JPEG keeps every receipt line readable at a fraction of the size.
 */

/** Longest edge of the output image, in pixels. */
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.8;

/** Must stay in sync with MAX_PHOTO_BYTES in apps/server/src/index.ts. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Types the server accepts as-is; must match PHOTO_CONTENT_TYPES there. */
const UPLOADABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const fitsUnchanged = (file: File) =>
  UPLOADABLE_TYPES.has(file.type) && file.size <= MAX_UPLOAD_BYTES;

export async function compressImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Undecodable here (e.g. HEIC outside Safari). The original is still fine
    // if the server would take it verbatim; otherwise there is nothing this
    // client can do with it.
    if (fitsUnchanged(file)) return file;
    throw new Error("This image format can't be compressed by your browser");
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not process the image");
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) throw new Error("Could not process the image");

    // A downscaled JPEG that still exceeds the cap means something degenerate;
    // refuse rather than let the server bounce it with a less helpful 413.
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("Image is still too large after compression");
    }

    // Re-encoding can inflate small, already-efficient files (e.g. WebP);
    // keep the original when it is both smaller and directly uploadable.
    return fitsUnchanged(file) && file.size < blob.size ? file : blob;
  } finally {
    bitmap.close();
  }
}
