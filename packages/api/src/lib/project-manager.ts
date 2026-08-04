import type { Role } from "./permissions";

export function canAssignProjectManager({
  actorId,
  canManageMembers,
  currentManagerId,
  nextManagerId,
}: {
  actorId: string;
  canManageMembers: boolean;
  currentManagerId: string | null;
  nextManagerId: string | null;
}) {
  if (canManageMembers || currentManagerId === nextManagerId) return true;

  // A regular user may manage only their own assignment. They cannot displace
  // or clear somebody whom a supervisor appointed.
  if (currentManagerId !== null && currentManagerId !== actorId) return false;
  return nextManagerId === null || nextManagerId === actorId;
}

export function projectMembershipIds({
  creatorId,
  creatorRole,
  manager,
}: {
  creatorId: string;
  creatorRole: Role;
  manager: { id: string; role: "admin" | "user" } | null;
}) {
  const ids = new Set<string>();
  if (creatorRole === "user") ids.add(creatorId);
  if (manager?.role === "user") ids.add(manager.id);
  return [...ids];
}
