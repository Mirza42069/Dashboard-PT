export const MAX_SELECTED_PROJECT_EXPORTS = 100;

export type SelectedProjectExportRequest = {
  projectIds: string[];
  locale?: "en" | "id";
};

export class ProjectExportRequestError extends Error {}

/** Validates the untrusted JSON body before any project lookup or file work. */
export function parseProjectExportRequest(value: unknown): SelectedProjectExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectExportRequestError("Expected a JSON object");
  }

  const { projectIds, locale } = value as Record<string, unknown>;
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

  return { projectIds: projectIds as string[], locale: locale as "en" | "id" | undefined };
}
