import { expect, test } from "bun:test";
import { selectedReportingPeriod } from "./reporting-period";

const periods = [
  { id: "p1", status: "locked" },
  { id: "p2", status: "submitted" },
  { id: "p3", status: "open" },
];

test("workflow and matrix default to the first unfinished report, including submitted periods", () => {
  expect(selectedReportingPeriod(periods, null)?.id).toBe("p2");
});

test("explicit selection wins, including read-only periods", () => {
  expect(selectedReportingPeriod(periods, "p1")?.id).toBe("p1");
  expect(selectedReportingPeriod(periods, "p3")?.id).toBe("p3");
});

test("stale selections fall back and fully approved projects show the last period", () => {
  expect(selectedReportingPeriod(periods, "removed")?.id).toBe("p2");
  expect(selectedReportingPeriod(periods.map((period) => ({ ...period, status: "approved" })), null)?.id).toBe("p3");
  expect(selectedReportingPeriod([], null)).toBeUndefined();
});
