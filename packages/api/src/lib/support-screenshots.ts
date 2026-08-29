export const MAX_SUPPORT_SCREENSHOTS = 3;
export const MAX_SUPPORT_SCREENSHOT_BYTES = 50 * 1024 * 1024;
export const SUPPORT_SCREENSHOT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportScreenshotContentType = (typeof SUPPORT_SCREENSHOT_CONTENT_TYPES)[number];

const EXTENSIONS: Record<SupportScreenshotContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function supportScreenshotExtension(contentType: SupportScreenshotContentType) {
  return EXTENSIONS[contentType];
}

export function supportScreenshotPrefix(userId: string) {
  return `support-screenshots/${userId}/`;
}

export function isSupportScreenshotContentType(
  value: string,
): value is SupportScreenshotContentType {
  return SUPPORT_SCREENSHOT_CONTENT_TYPES.includes(value as SupportScreenshotContentType);
}

export function isOwnedSupportScreenshotPath(pathname: string, userId: string) {
  return (
    pathname.startsWith(supportScreenshotPrefix(userId)) &&
    !pathname.includes("..") &&
    /\.(?:jpe?g|png|webp)$/i.test(pathname)
  );
}

export function supportScreenshotSelectionIssue(
  files: readonly { size: number; contentType: string }[],
): "too-many" | "too-large" | "unsupported" | null {
  if (files.length > MAX_SUPPORT_SCREENSHOTS) return "too-many";
  if (files.some((file) => file.size <= 0 || !isSupportScreenshotContentType(file.contentType))) {
    return "unsupported";
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return total > MAX_SUPPORT_SCREENSHOT_BYTES ? "too-large" : null;
}

export function canReadSupportScreenshot(input: {
  requesterId: string | null;
  userId: string;
  canManageSupport: boolean;
}) {
  return input.canManageSupport || input.requesterId === input.userId;
}
