import { describe, expect, test } from "bun:test";

import { demoEmail, escapeHtml, parseDemoLead } from "./demo-form";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("demo lead validation", () => {
  test("accepts a complete Indonesian lead", () => {
    const result = parseDemoLead(
      form({
        locale: "id",
        name: "Ana Wijaya",
        company: "PT Contoh",
        email: "ana@example.com",
        role: "Project Controls",
        size: "8",
        challenge: "Pelaporan progres tersebar di banyak file.",
      }),
    );

    expect(result.errors).toEqual({});
    expect(result.lead?.company).toBe("PT Contoh");
  });

  test("returns localized validation errors", () => {
    const result = parseDemoLead(
      form({ locale: "en", name: "", company: "", email: "wrong", role: "", size: "many" }),
    );

    expect(result.lead).toBeUndefined();
    expect(result.errors.name).toBe("Required");
    expect(result.errors.email).toBe("Enter a valid work email");
    expect(result.errors.size).toBe("Enter a project count");
  });

  test("escapes all lead values in the HTML email", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#039;y&#039;&lt;/script&gt;",
    );
    const parsed = parseDemoLead(
      form({
        locale: "en",
        name: "<b>Ana</b>",
        company: "Example & Co",
        email: "ana@example.com",
        role: "Director",
        size: "3",
        challenge: "<img src=x onerror=alert(1)>",
      }),
    );
    expect(parsed.lead).toBeDefined();
    expect(demoEmail(parsed.lead!).html).not.toContain("<img src=x");
  });
});
