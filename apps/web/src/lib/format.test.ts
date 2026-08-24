import { describe, expect, test } from "bun:test";

import {
  formatRupiahInput,
  formatRupiahInputText,
  getFormatters,
  parseRupiahInput,
} from "./format";

describe("rupiah formatting", () => {
  test("uses Indonesian grouping in every interface locale", () => {
    expect(getFormatters("id-ID").money(1_000_000)).toBe("Rp1.000.000");
    expect(getFormatters("en-US").money(1_000_000)).toBe("Rp1.000.000");
    expect(getFormatters("en-US").money(-50_000)).toBe("-Rp50.000");
  });

  test("groups whole-rupiah input values without a prefix", () => {
    expect(formatRupiahInput(1_000_000)).toBe("1.000.000");
    expect(formatRupiahInput(12.5)).toBe("12,5");
    expect(formatRupiahInput(0)).toBe("0");
    expect(formatRupiahInputText("1000000,")).toBe("1.000.000,");
    expect(formatRupiahInputText("1000000,12567")).toBe("1.000.000,1256");
  });

  test("parses grouped and ungrouped whole-rupiah input", () => {
    expect(parseRupiahInput("1.000.000")).toBe(1_000_000);
    expect(parseRupiahInput("1000000")).toBe(1_000_000);
    expect(parseRupiahInput("Rp 1.000.000")).toBe(1_000_000);
    expect(parseRupiahInput("1.000.000,1256")).toBe(1_000_000.1256);
    expect(parseRupiahInput("")).toBe(0);
  });
});
