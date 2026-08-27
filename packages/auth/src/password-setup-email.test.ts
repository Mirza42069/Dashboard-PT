import { describe, expect, test } from "bun:test";

import { passwordSetupEmail } from "./password-setup-email";

describe("password setup email", () => {
  test("sends a one-time setup link without exposing a temporary password", () => {
    const message = passwordSetupEmail({
      name: "Ayu",
      email: "ayu@example.com",
      url: "https://app.fushin.ai/set-password?token=one-time-token",
    });

    expect(message.subject).toBe("Set up your Fushin AI account");
    expect(message.text).toContain("ayu@example.com");
    expect(message.text).toContain("https://app.fushin.ai/set-password?token=one-time-token");
    expect(message.text).toContain("expires in 24 hours");
    expect(message.text.toLowerCase()).not.toContain("temporary password");
  });

  test("escapes account data in the HTML message", () => {
    const message = passwordSetupEmail({
      name: "<Ayu & Co>",
      email: "ayu@example.com",
      url: "https://app.fushin.ai/set-password?token=a&next=b",
    });

    expect(message.html).toContain("&lt;Ayu &amp; Co&gt;");
    expect(message.html).toContain("token=a&amp;next=b");
    expect(message.html).not.toContain("<Ayu & Co>");
  });
});
