import { describe, expect, test } from "bun:test";

import { progressRampColor } from "./progress-tone";

describe("progressRampColor", () => {
  test("the endpoints are the outer stops, unmixed", () => {
    expect(progressRampColor(0)).toBe(
      "color-mix(in oklch, var(--progress-1), var(--progress-2) 0%)",
    );
    expect(progressRampColor(1)).toBe(
      "color-mix(in oklch, var(--progress-4), var(--progress-5) 100%)",
    );
  });

  test("each supplied colour is an evenly spaced stop", () => {
    expect(progressRampColor(0.25)).toBe(
      "color-mix(in oklch, var(--progress-2), var(--progress-3) 0%)",
    );
    expect(progressRampColor(0.5)).toBe(
      "color-mix(in oklch, var(--progress-3), var(--progress-4) 0%)",
    );
    expect(progressRampColor(0.75)).toBe(
      "color-mix(in oklch, var(--progress-4), var(--progress-5) 0%)",
    );
  });

  test("interpolates within each adjacent pair", () => {
    expect(progressRampColor(0.125)).toBe(
      "color-mix(in oklch, var(--progress-1), var(--progress-2) 50%)",
    );
    expect(progressRampColor(0.625)).toBe(
      "color-mix(in oklch, var(--progress-3), var(--progress-4) 50%)",
    );
  });

  test("out-of-range positions clamp rather than extrapolate", () => {
    expect(progressRampColor(-1)).toBe(progressRampColor(0));
    expect(progressRampColor(4)).toBe(progressRampColor(1));
  });

  test("a non-finite position falls back to the start of the ramp", () => {
    expect(progressRampColor(Number.NaN)).toBe(progressRampColor(0));
    expect(progressRampColor(Number.POSITIVE_INFINITY)).toBe(progressRampColor(0));
  });
});
