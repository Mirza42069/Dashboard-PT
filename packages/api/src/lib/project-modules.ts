export const PROJECT_MODULE_KEYS = ["actions", "baseline", "progress", "notes"] as const;

export type ProjectModuleKey = (typeof PROJECT_MODULE_KEYS)[number];

const PROJECT_MODULE_SET = new Set<string>(PROJECT_MODULE_KEYS);

export function isProjectModuleKey(value: unknown): value is ProjectModuleKey {
  return typeof value === "string" && PROJECT_MODULE_SET.has(value);
}

/** Ignores stale keys and returns a stable order for storage, comparison and UI. */
export function normalizeHiddenProjectModules(values: readonly string[]) {
  const selected = new Set(values.filter(isProjectModuleKey));
  return PROJECT_MODULE_KEYS.filter((key) => selected.has(key));
}
