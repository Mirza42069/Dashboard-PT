import { describe, expect, test } from "bun:test";

import { deviationPosition, isBehindDeviation } from "./deviation";

describe("displayed deviation classification", () => {
  test("treats values that display as minus as behind", () => {
    expect(deviationPosition(-0.05)).toBe("behind");
    expect(isBehindDeviation(-8.4)).toBe(true);
  });

  test("ignores sub-display rounding noise", () => {
    expect(deviationPosition(-0.049)).toBe("on_track");
    expect(deviationPosition(0)).toBe("on_track");
    expect(deviationPosition(0.049)).toBe("on_track");
  });

  test("classifies positive and unavailable values", () => {
    expect(deviationPosition(0.05)).toBe("ahead");
    expect(deviationPosition(null)).toBeNull();
  });
});
