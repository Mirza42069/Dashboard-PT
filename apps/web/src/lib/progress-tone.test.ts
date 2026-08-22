import { describe, expect, test } from "bun:test";

import { progressRampColor } from "./progress-tone";

describe("progressRampColor", () => {
  test("the endpoints are the outer stops, unmixed", () => {
    expect(progressRampColor(0)).toBe(
      "color-mix(in oklch, var(--progress-low), var(--progress-mid) 0%)",
    );
    expect(progressRampColor(1)).toBe(
      "color-mix(in oklch, var(--progress-mid), var(--progress-high) 100%)",
    );
  });

  test("the mid stop is amber, unmixed from either side", () => {
    // 0.4 is the boundary and belongs to the lower half, so it comes out as
    // 100% of the second colour there rather than 0% of it in the upper half.
    expect(progressRampColor(0.4)).toBe(
      "color-mix(in oklch, var(--progress-low), var(--progress-mid) 100%)",
    );
  });

  test("a third of the way along is most of the way to amber", () => {
    // The reason MID_STOP is 0.4: a bar at ~30% has to read yellowish, not
    // orange. At a 0.5 stop this would be 60%.
    expect(progressRampColor(0.3)).toBe(
      "color-mix(in oklch, var(--progress-low), var(--progress-mid) 75%)",
    );
  });

  test("the upper half walks amber to green", () => {
    expect(progressRampColor(0.7)).toBe(
      "color-mix(in oklch, var(--progress-mid), var(--progress-high) 50%)",
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
