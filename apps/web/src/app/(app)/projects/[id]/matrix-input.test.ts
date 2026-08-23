import { describe, expect, test } from "bun:test";

import { MATRIX_MAX_DIGITS, decimalOnly } from "./matrix-input";

describe("decimalOnly", () => {
  test("keeps a plain decimal untouched", () => {
    expect(decimalOnly("12.5")).toBe("12.5");
    expect(decimalOnly("0")).toBe("0");
    expect(decimalOnly("100")).toBe("100");
  });

  test("keeps half-typed values so the field can be typed into", () => {
    expect(decimalOnly("1.")).toBe("1.");
    expect(decimalOnly("-")).toBe("-");
  });

  test("strips letters and stray punctuation", () => {
    expect(decimalOnly("12abc")).toBe("12");
    expect(decimalOnly("1,5")).toBe("15");
    expect(decimalOnly("50%")).toBe("50");
    expect(decimalOnly(" 7 ")).toBe("7");
  });

  test("allows only the first decimal point", () => {
    expect(decimalOnly("1.2.3")).toBe("1.23");
    expect(decimalOnly("...")).toBe(".");
  });

  test("allows a minus only as a leading sign", () => {
    expect(decimalOnly("-2.5")).toBe("-2.5");
    expect(decimalOnly("2-5")).toBe("25");
    expect(decimalOnly("--2")).toBe("-2");
  });

  test("an empty field stays empty — a blank cell is not a reading of zero", () => {
    expect(decimalOnly("")).toBe("");
    expect(decimalOnly("abc")).toBe("");
  });

  test("what survives is always parseable or empty", () => {
    for (const raw of ["12.5", "1.2.3", "abc", "-2", "50%", "", "9e9", "1,5", "12.3456789"]) {
      const cleaned = decimalOnly(raw);
      if (cleaned === "" || cleaned === "-" || cleaned.endsWith(".")) continue;
      expect(Number.isFinite(Number(cleaned))).toBe(true);
    }
  });
});

describe("decimalOnly digit cap", () => {
  test("four digits is the default budget", () => {
    expect(MATRIX_MAX_DIGITS).toBe(4);
  });

  test("keeps everything that fits the column it was measured for", () => {
    expect(decimalOnly("12.5")).toBe("12.5");
    expect(decimalOnly("99.99")).toBe("99.99");
    expect(decimalOnly("100.0")).toBe("100.0");
    expect(decimalOnly("1234")).toBe("1234");
  });

  test("drops the fifth digit rather than the value someone already typed", () => {
    expect(decimalOnly("100.55")).toBe("100.5");
    expect(decimalOnly("12345")).toBe("1234");
    expect(decimalOnly("12.3456789")).toBe("12.34");
  });

  test("neither the point nor the sign spends the budget", () => {
    expect(decimalOnly("-99.99")).toBe("-99.99");
    expect(decimalOnly("-1234")).toBe("-1234");
  });

  test("refuses a point no fraction could follow", () => {
    // Four digits are already spent, so the "." would be punctuation the field
    // will not let you complete.
    expect(decimalOnly("1234.")).toBe("1234");
    expect(decimalOnly("1234.5")).toBe("1234");
  });

  test("honours an explicit budget", () => {
    expect(decimalOnly("12345", 2)).toBe("12");
    expect(decimalOnly("1.25", 2)).toBe("1.2");
    expect(decimalOnly("123456789", 6)).toBe("123456");
  });

  test("half-typed values still survive under the cap", () => {
    expect(decimalOnly("1.")).toBe("1.");
    expect(decimalOnly("-")).toBe("-");
    expect(decimalOnly("999.")).toBe("999.");
  });
});
