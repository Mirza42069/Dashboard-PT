import { createHmac, timingSafeEqual } from "node:crypto";

export type ReviewedProjectState = {
  code: string;
  name: string;
  client: string | null;
  location: string | null;
  startDate: string | null;
  scheduleStart: string | null;
  endDate: string | null;
  periodType: string;
  periodLengthDays: number | null;
};

export type WorkbookReviewState = {
  project: ReviewedProjectState;
  existingActualSnapshots: { periodIndex: number; cumulativePercent: number }[];
  activeVersionId: string | null;
  progressEntryCount: number;
  latestProgressUpdatedAt: string | null;
};

type PdfSourceCalendar = {
  startDate: string | null;
  scheduleStartDate: string | null;
  endDate: string | null;
  periodType: string;
};

type ReviewedSections = {
  projectDetails: boolean;
  boq: boolean;
  schedule: boolean;
  progress: boolean;
};

export function relevantProjectStateChanged(
  current: ReviewedProjectState,
  reviewed: ReviewedProjectState,
  sections: ReviewedSections,
) {
  if (
    sections.projectDetails &&
    (current.code !== reviewed.code ||
      current.name !== reviewed.name ||
      current.client !== reviewed.client ||
      current.location !== reviewed.location)
  ) {
    return true;
  }

  return (
    (sections.boq || sections.schedule || sections.progress) &&
    (current.startDate !== reviewed.startDate ||
      current.scheduleStart !== reviewed.scheduleStart ||
      current.endDate !== reviewed.endDate ||
      current.periodType !== reviewed.periodType ||
      current.periodLengthDays !== reviewed.periodLengthDays)
  );
}

export function pdfCalendarDifferences(
  current: ReviewedProjectState,
  source: PdfSourceCalendar,
) {
  const differences: string[] = [];
  if (source.startDate !== null && source.startDate !== current.startDate) {
    differences.push("startDate");
  }
  if (
    source.scheduleStartDate !== null &&
    source.scheduleStartDate !== current.scheduleStart
  ) {
    differences.push("scheduleStart");
  }
  if (source.endDate !== null && source.endDate !== current.endDate) {
    differences.push("endDate");
  }
  if (source.periodType !== current.periodType) differences.push("periodType");
  return differences;
}

function reviewSigningSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is required to sign workbook review state.");
  }
  return secret ?? "test-only-workbook-review-signing-secret";
}

export function signWorkbookReviewState(
  projectId: string,
  analysisSignature: string,
  state: WorkbookReviewState,
) {
  return createHmac("sha256", reviewSigningSecret())
    .update(JSON.stringify({ projectId, analysisSignature, state }))
    .digest("hex");
}

export function hasValidWorkbookReviewStateSignature(
  projectId: string,
  analysisSignature: string,
  state: WorkbookReviewState,
  signature: string,
) {
  const expected = Buffer.from(
    signWorkbookReviewState(projectId, analysisSignature, state),
    "hex",
  );
  const submitted = Buffer.from(signature, "hex");
  return expected.length === submitted.length && timingSafeEqual(expected, submitted);
}
