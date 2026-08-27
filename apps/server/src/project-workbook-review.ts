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
