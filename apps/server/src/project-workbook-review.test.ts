import { expect, test } from "bun:test";

import { relevantProjectStateChanged, type ReviewedProjectState } from "./project-workbook-review";

const REVIEWED: ReviewedProjectState = {
  code: "P-0",
  name: "PEKERJAAN STRUCTURE RSU CITRA HARAPAN",
  client: null,
  location: null,
  startDate: "2026-05-02",
  scheduleStart: "2026-05-03",
  endDate: "2026-08-29",
  periodType: "weekly",
  periodLengthDays: null,
};

test("progress updates ignore unrelated project-row changes", () => {
  expect(
    relevantProjectStateChanged(REVIEWED, REVIEWED, {
      projectDetails: false,
      boq: false,
      schedule: false,
      progress: true,
    }),
  ).toBe(false);
});

test("each selected section protects only the project fields it uses", () => {
  expect(
    relevantProjectStateChanged(
      { ...REVIEWED, name: "Changed" },
      REVIEWED,
      { projectDetails: false, boq: false, schedule: false, progress: true },
    ),
  ).toBe(false);
  expect(
    relevantProjectStateChanged(
      { ...REVIEWED, name: "Changed" },
      REVIEWED,
      { projectDetails: true, boq: false, schedule: false, progress: false },
    ),
  ).toBe(true);
  expect(
    relevantProjectStateChanged(
      { ...REVIEWED, endDate: "2026-09-05" },
      REVIEWED,
      { projectDetails: false, boq: false, schedule: false, progress: true },
    ),
  ).toBe(true);
});
