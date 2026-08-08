import { describe, expect, test } from "bun:test";

import { allowsCompanyVertical } from "./vertical-policy";

describe("company vertical policy", () => {
  test("allows only an exact vertical match", () => {
    expect(allowsCompanyVertical("construction", "construction")).toBe(true);
    expect(allowsCompanyVertical("dental", "dental")).toBe(true);
    expect(allowsCompanyVertical("dental", "construction")).toBe(false);
    expect(allowsCompanyVertical("construction", "dental")).toBe(false);
  });
});
