import { describe, expect, test } from "bun:test";

import { behindDelta, levelFor, signalsFor, type SeverityInput } from "./severity";

function row(overrides: Partial<SeverityInput> = {}): SeverityInput {
  return {
    deviation: 0,
    previousDeviation: 0,
    reportsDue: 0,
    reportsAwaitingReview: 0,
    openTickets: 0,
    reasons: {
      behind: false,
      baselineMissing: false,
      unreported: false,
      stale: false,
      reportsDue: false,
      awaitingReview: false,
      openActions: false,
    },
    ...overrides,
  };
}

const reasons = (partial: Partial<SeverityInput["reasons"]>) => ({
  ...row().reasons,
  ...partial,
});

describe("signalsFor", () => {
  test("a clean row carries nothing", () => {
    expect(signalsFor(row())).toEqual([]);
  });

  test("only the reasons that are set appear", () => {
    const signals = signalsFor(row({ reasons: reasons({ behind: true, stale: true }) }));
    expect(signals.map((signal) => signal.id)).toEqual(["behind", "stale"]);
  });

  test("worst first, regardless of which reasons are set", () => {
    const signals = signalsFor(
      row({ reasons: reasons({ openActions: true, stale: true, behind: true }) }),
    );
    expect(signals.map((signal) => signal.id)).toEqual(["behind", "stale", "openActions"]);
  });

  test("counts ride along only where counting means something", () => {
    const signals = signalsFor(
      row({
        reportsDue: 3,
        reportsAwaitingReview: 2,
        openTickets: 7,
        reasons: reasons({
          reportsDue: true,
          awaitingReview: true,
          openActions: true,
          behind: true,
        }),
      }),
    );
    const counts = Object.fromEntries(signals.map((signal) => [signal.id, signal.count]));
    expect(counts).toEqual({
      behind: undefined,
      reportsDue: 3,
      awaitingReview: 2,
      openActions: 7,
    });
  });
});

describe("levelFor", () => {
  test("nothing outstanding is settled", () => {
    expect(levelFor(row())).toBe("settled");
  });

  test("behind is late, and outranks everything else", () => {
    expect(levelFor(row({ reasons: reasons({ behind: true }) }))).toBe("late");
    expect(levelFor(row({ reasons: reasons({ behind: true, stale: true }) }))).toBe("late");
    expect(levelFor(row({ reasons: reasons({ behind: true, openActions: true }) }))).toBe("late");
  });

  test("the reporting reasons are waiting", () => {
    for (const reason of ["stale", "reportsDue", "unreported", "awaitingReview", "baselineMissing"] as const) {
      expect(levelFor(row({ reasons: reasons({ [reason]: true }) }))).toBe("waiting");
    }
  });

  test("open actions alone never colour a row", () => {
    expect(levelFor(row({ openTickets: 9, reasons: reasons({ openActions: true }) }))).toBe(
      "settled",
    );
  });
});

describe("behindDelta", () => {
  test("null when nothing can be compared", () => {
    expect(behindDelta([])).toBeNull();
    expect(behindDelta([row({ deviation: -5, previousDeviation: null })])).toBeNull();
  });

  test("counts both sides of the same list", () => {
    // Two behind now; one of them was behind before.
    expect(
      behindDelta([
        row({ deviation: -5, previousDeviation: -4 }),
        row({ deviation: -2, previousDeviation: 1 }),
        row({ deviation: 3, previousDeviation: 2 }),
      ]),
    ).toBe(1);
  });

  test("negative when projects recovered", () => {
    expect(
      behindDelta([
        row({ deviation: 1, previousDeviation: -4 }),
        row({ deviation: 2, previousDeviation: -3 }),
      ]),
    ).toBe(-2);
  });

  test("zero when the count held, even if the projects changed", () => {
    expect(
      behindDelta([
        row({ deviation: -1, previousDeviation: 2 }),
        row({ deviation: 2, previousDeviation: -1 }),
      ]),
    ).toBe(0);
  });

  test("a first-ever reading cannot read as an improvement", () => {
    // Previously unknown, now behind: excluded from both sides, so no movement.
    expect(behindDelta([row({ deviation: -9, previousDeviation: null })])).toBeNull();
  });

  test("the display threshold applies — a hair behind is not behind", () => {
    expect(behindDelta([row({ deviation: -0.01, previousDeviation: 0 })])).toBe(0);
    expect(behindDelta([row({ deviation: -0.05, previousDeviation: 0 })])).toBe(1);
  });
});
