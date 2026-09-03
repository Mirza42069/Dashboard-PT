import type { ProjectModuleKey } from "@DashboardV2/api/lib/project-modules";

export const PROJECT_TABS = [
  "overview",
  "tickets",
  "baseline",
  "progress",
  "notes",
  "team",
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

export const BASELINE_STEPS = ["boq", "schedule", "review"] as const;

export type BaselineStep = (typeof BASELINE_STEPS)[number];

const TAB_MODULE: Partial<Record<ProjectTab, ProjectModuleKey>> = {
  tickets: "actions",
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
  const normalized = requested === "boq" || requested === "schedule" ? "baseline" : requested;
  const tab = PROJECT_TABS.find((value) => value === normalized) ?? "overview";
  return isProjectTabVisible(tab, hiddenModules, canManageMembers) ? tab : "overview";
}

export function resolveBaselineStep(
  requestedTab: string | null | undefined,
  requestedStep: string | null | undefined,
): BaselineStep {
  if (requestedTab === "boq" || requestedTab === "schedule") return requestedTab;
  return BASELINE_STEPS.find((value) => value === requestedStep) ?? "review";
}

export function projectTabPath(
  projectId: string,
  requested: ProjectTab,
  hiddenModules: readonly ProjectModuleKey[],
  baselineStep: BaselineStep = "boq",
  canManageMembers = false,
) {
  const tab = resolveProjectTab(requested, hiddenModules, canManageMembers);
  const base = `/projects/${projectId}`;
  if (tab === "overview") return base;
  return tab === "baseline"
    ? `${base}?tab=baseline&step=${baselineStep}`
    : `${base}?tab=${tab}`;
}
