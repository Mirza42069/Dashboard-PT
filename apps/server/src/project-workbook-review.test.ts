import { expect, test } from "bun:test";

import {
  hasValidWorkbookReviewStateSignature,
  pdfCalendarDifferences,
  relevantProjectStateChanged,
  signWorkbookReviewState,
  type ReviewedProjectState,
  type WorkbookReviewState,
} from "./project-workbook-review";

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

test("PDF source calendars must match the project calendar when provided", () => {
  expect(
    pdfCalendarDifferences(REVIEWED, {
      startDate: "2026-05-02",
      scheduleStartDate: "2026-05-03",
      endDate: "2026-08-29",
      periodType: "weekly",
    }),
  ).toEqual([]);
  expect(
    pdfCalendarDifferences(REVIEWED, {
      startDate: null,
      scheduleStartDate: null,
      endDate: "2026-09-30",
      periodType: "monthly",
    }),
  ).toEqual(["endDate", "periodType"]);
});

test("review-state signatures bind the snapshot to its project and analysis", () => {
  const state: WorkbookReviewState = {
    project: REVIEWED,
    existingActualSnapshots: [{ periodIndex: 1, cumulativePercent: 12.5 }],
    activeVersionId: "version-1",
    progressEntryCount: 3,
    latestProgressUpdatedAt: "2026-08-29T12:00:00.000Z",
  };
  const signature = signWorkbookReviewState("project-1", "analysis-1", state);

  expect(hasValidWorkbookReviewStateSignature("project-1", "analysis-1", state, signature)).toBe(
    true,
  );
  expect(
    hasValidWorkbookReviewStateSignature(
      "project-1",
      "analysis-1",
      { ...state, progressEntryCount: 4 },
      signature,
    ),
  ).toBe(false);
  expect(hasValidWorkbookReviewStateSignature("project-2", "analysis-1", state, signature)).toBe(
    false,
  );
});
