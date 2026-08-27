import { expect, test } from "bun:test";

import { getWorkbookScheduleIssue } from "./project-workbook-schedule";

const PLAN = {
  profile: "reference-s-curve" as const,
  periodCount: 17,
  suggestedStartDate: "2026-05-02",
  suggestedScheduleStartDate: "2026-05-03",
  suggestedEndDate: "2026-08-29",
  periodType: "weekly" as const,
};

test("the supplied S-curve calendar is an exact match", () => {
  expect(
    getWorkbookScheduleIssue(
      {
        startDate: "2026-05-02",
        scheduleStart: "2026-05-03",
        endDate: "2026-08-29",
        periodType: "weekly",
        periodLengthDays: null,
      },
      PLAN,
    ),
  ).toBeNull();
});

test("calendar mismatches identify the fields that differ", () => {
  expect(
    getWorkbookScheduleIssue(
      {
        startDate: "2026-05-02",
        scheduleStart: "2026-05-02",
        endDate: "2026-08-29",
        periodType: "monthly",
        periodLengthDays: null,
      },
      PLAN,
    ),
  ).toMatchObject({
    code: "workbook_calendar_mismatch",
    differences: ["scheduleStart", "periodType"],
  });
});
