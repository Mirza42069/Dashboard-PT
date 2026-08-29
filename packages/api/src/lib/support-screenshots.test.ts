import { describe, expect, test } from "bun:test";

import {
  MAX_SUPPORT_SCREENSHOT_BYTES,
  MAX_SUPPORT_SCREENSHOTS,
  canReadSupportScreenshot,
  isOwnedSupportScreenshotPath,
  isSupportScreenshotContentType,
  supportScreenshotExtension,
  supportScreenshotSelectionIssue,
} from "./support-screenshots";

describe("support screenshots", () => {
  test("defines the product limits", () => {
    expect(MAX_SUPPORT_SCREENSHOTS).toBe(3);
    expect(MAX_SUPPORT_SCREENSHOT_BYTES).toBe(50 * 1024 * 1024);
  });

  test("accepts only safe browser image types", () => {
    expect(isSupportScreenshotContentType("image/png")).toBe(true);
    expect(isSupportScreenshotContentType("image/jpeg")).toBe(true);
    expect(isSupportScreenshotContentType("image/webp")).toBe(true);
    expect(isSupportScreenshotContentType("image/svg+xml")).toBe(false);
  });

  test("maps content types to generated path extensions", () => {
    expect(supportScreenshotExtension("image/jpeg")).toBe("jpg");
    expect(supportScreenshotExtension("image/png")).toBe("png");
    expect(supportScreenshotExtension("image/webp")).toBe("webp");
  });

  test("requires a user-owned path without traversal", () => {
    expect(isOwnedSupportScreenshotPath("support-screenshots/user-1/shot.png", "user-1")).toBe(
      true,
    );
    expect(isOwnedSupportScreenshotPath("support-screenshots/user-2/shot.png", "user-1")).toBe(
      false,
    );
    expect(
      isOwnedSupportScreenshotPath("support-screenshots/user-1/../user-2/shot.png", "user-1"),
    ).toBe(false);
    expect(isOwnedSupportScreenshotPath("support-screenshots/user-1/shot.svg", "user-1")).toBe(
      false,
    );
  });

  test("enforces count, type, and combined size", () => {
    expect(
      supportScreenshotSelectionIssue(
        Array.from({ length: 4 }, () => ({ size: 1, contentType: "image/png" })),
      ),
    ).toBe("too-many");
    expect(
      supportScreenshotSelectionIssue([{ size: 1, contentType: "image/svg+xml" }]),
    ).toBe("unsupported");
    expect(
      supportScreenshotSelectionIssue([
        { size: 30 * 1024 * 1024, contentType: "image/png" },
        { size: 21 * 1024 * 1024, contentType: "image/jpeg" },
      ]),
    ).toBe("too-large");
    expect(
      supportScreenshotSelectionIssue([
        { size: 25 * 1024 * 1024, contentType: "image/png" },
        { size: 25 * 1024 * 1024, contentType: "image/webp" },
      ]),
    ).toBeNull();
  });

  test("allows only the requester or support managers to read a screenshot", () => {
    expect(
      canReadSupportScreenshot({ requesterId: "user-1", userId: "user-1", canManageSupport: false }),
    ).toBe(true);
    expect(
      canReadSupportScreenshot({ requesterId: "user-1", userId: "user-2", canManageSupport: true }),
    ).toBe(true);
    expect(
      canReadSupportScreenshot({ requesterId: "user-1", userId: "user-2", canManageSupport: false }),
    ).toBe(false);
  });
});
