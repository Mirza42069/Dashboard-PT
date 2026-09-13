import { describe, expect, test } from "bun:test";

import { levelFor, signalsFor, type SeverityInput } from "./severity";

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
