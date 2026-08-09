export const PROJECT_STATUSES = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;

export type ProjectFormValues = {
  code: string;
  name: string;
  client: string;
  location: string;
  status: (typeof PROJECT_STATUSES)[number];
  managerId: string;
  startDate: string;
  endDate: string;
  progress: string;
  notes: string;
};

export const EMPTY_PROJECT: ProjectFormValues = {
  code: "",
  name: "",
  client: "",
  location: "",
  status: "planning",
  managerId: "",
  startDate: "",
  endDate: "",
  progress: "0",
  notes: "",
};

export function projectToFormValues(row: {
  code: string;
  name: string;
  client: string | null;
  location: string | null;
  status: (typeof PROJECT_STATUSES)[number];
  managerId: string | null;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  notes: string | null;
}): ProjectFormValues {
  return {
    code: row.code,
    name: row.name,
    client: row.client ?? "",
    location: row.location ?? "",
    status: row.status,
    managerId: row.managerId ?? "",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    progress: String(row.progress),
    notes: row.notes ?? "",
  };
}
