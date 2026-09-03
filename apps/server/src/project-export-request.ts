export const MAX_SELECTED_PROJECT_EXPORTS = 100;

export type SelectedProjectExportRequest = {
  projectIds: string[];
  locale?: "en" | "id";
  /** Picks the dated snapshot shown on the signature-ready Daily Report sheet. */
  dailyReportDate?: string;
};

export class ProjectExportRequestError extends Error {}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Validates the untrusted JSON body before any project lookup or file work. */
export function parseProjectExportRequest(value: unknown): SelectedProjectExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectExportRequestError("Expected a JSON object");
  }

  const { projectIds, locale, dailyReportDate } = value as Record<string, unknown>;
  if (!Array.isArray(projectIds) || projectIds.length === 0) {
    throw new ProjectExportRequestError("Select at least one project");
  }
  if (projectIds.length > MAX_SELECTED_PROJECT_EXPORTS) {
    throw new ProjectExportRequestError(
      `Select no more than ${MAX_SELECTED_PROJECT_EXPORTS} projects`,
    );
  }
  if (projectIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 200)) {
    throw new ProjectExportRequestError("Every project ID must be a non-empty string");
  }
  if (new Set(projectIds).size !== projectIds.length) {
    throw new ProjectExportRequestError("Project IDs must be unique");
  }
  if (locale !== undefined && locale !== "en" && locale !== "id") {
    throw new ProjectExportRequestError("Locale must be en or id");
  }
  if (dailyReportDate !== undefined && (typeof dailyReportDate !== "string" || !isIsoDate(dailyReportDate))) {
    throw new ProjectExportRequestError("The daily report date must be an ISO date");
  }

  return {
    projectIds: projectIds as string[],
    locale: locale as "en" | "id" | undefined,
    ...(typeof dailyReportDate === "string" ? { dailyReportDate } : {}),
  };
}
