import type { ProjectModuleKey } from "@DashboardV2/api/lib/project-modules";

export const PROJECT_TABS = [
  "overview",
  "tickets",
  "boq",
  "schedule",
  "baseline",
  "progress",
  "notes",
  "team",
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

export const BASELINE_STEP_TABS = {
  boq: "boq",
  schedule: "schedule",
  baseline: "review",
} as const;

const TAB_MODULE: Partial<Record<ProjectTab, ProjectModuleKey>> = {
  tickets: "actions",
  boq: "baseline",
  schedule: "baseline",
  baseline: "baseline",
  progress: "progress",
  notes: "notes",
};

export function isProjectTabVisible(
  tab: ProjectTab,
  hiddenModules: readonly ProjectModuleKey[],
  canManageMembers: boolean,
) {
  if (tab === "team") return canManageMembers;
  const module = TAB_MODULE[tab];
  return module === undefined || !hiddenModules.includes(module);
}

export function resolveProjectTab(
  requested: string | null | undefined,
  hiddenModules: readonly ProjectModuleKey[],
  canManageMembers: boolean,
): ProjectTab {
  const tab = PROJECT_TABS.find((value) => value === requested) ?? "overview";
  return isProjectTabVisible(tab, hiddenModules, canManageMembers) ? tab : "overview";
}

export function projectTabPath(
  projectId: string,
  requested: ProjectTab,
  hiddenModules: readonly ProjectModuleKey[],
  canManageMembers = false,
) {
  const tab = resolveProjectTab(requested, hiddenModules, canManageMembers);
  const base = `/projects/${projectId}`;
  return tab === "overview" ? base : `${base}?tab=${tab}`;
}
