import type { Role } from "./permissions";

export function planProjectAccessReconciliation({
  companyId,
  managedProjectIds,
  memberships,
  role,
}: {
  companyId: string | null;
  managedProjectIds: string[];
  memberships: { companyId: string; projectId: string }[];
  role: Role;
}) {
  return {
    grantProjectIds: role === "user" ? [...new Set(managedProjectIds)] : [],
    staleProjectIds: memberships
      .filter((membership) => role !== "user" || membership.companyId !== companyId)
      .map((membership) => membership.projectId),
  };
}
