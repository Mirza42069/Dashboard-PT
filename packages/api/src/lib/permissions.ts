/**
 * The whole authorization model, in one place, with no imports.
 *
 * Kept dependency-free on purpose: apps/web imports this directly (client
 * components narrow `session.user.role` through `roleOf`/`hasPermission`
 * without round-tripping through the server), so anything pulled in here —
 * db, env, auth — would leak into the browser bundle. Never add an import to
 * this file without checking that constraint first.
 */

export const ROLES = ["super_admin", "admin", "user"] as const;
export type Role = (typeof ROLES)[number];

/** Anything unrecognised (null, a stale/legacy value) degrades to the least-privileged role. */
export function roleOf(user: { role?: string | null }): Role {
  return (ROLES as readonly string[]).includes(user.role ?? "") ? (user.role as Role) : "user";
}

export const PERMISSIONS = [
  /** CRUD on the company/tenant list itself. */
  "company:manage",
  /** Honour the active-company cookie instead of being pinned to one company. */
  "company:switch",
  /** Create/reset-password/ban/delete accounts. Scope (which accounts) is enforced separately. */
  "user:manage",
  /** Promote/demote a role. */
  "user:setRole",
  /** Move an account to a different company. */
  "user:setCompany",
  "project:create",
  "project:delete",
  /** Editing a project's own fields. */
  "project:update",
  /** Reading a project and everything under it. */
  "project:read",
  /**
   * Mutating anything a project owns: tickets, notes/photos, BoQ,
   * schedule/distribution, progress entries. One permission for all of it —
   * the scope layer (company match, or project membership for role=user)
   * decides *which* projects, not this map.
   */
  "project:write",
  /** Assign users to a project's member list. */
  "member:manage",
  "activity:read",
  /**
   * Judge a submitted progress report: mark it reviewed, approve it, or send it
   * back. Deliberately separate from `project:write` — the point of the
   * workflow is that the person who enters the figures is not the person who
   * signs them off.
   */
  "progress:review",
  /**
   * Lock an approved period, and reopen a locked one for correction. The
   * narrower of the two reporting grants: locking is what makes a period the
   * agreed record, and reopening is what un-agrees it.
   */
  "progress:lock",
  /** Dental chart, scheduling, treatment and payment operations. */
  "dental:read",
  "dental:write",
  /** Hard removal and clinic configuration remain supervisory. */
  "dental:delete",
  "dental:settings",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS: readonly Permission[] = PERMISSIONS;

const GRANTS: Record<Role, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS.filter(
    (p) =>
      p !== "company:manage" &&
      p !== "company:switch" &&
      p !== "user:setRole" &&
      p !== "user:setCompany",
  ),
  // Management runs projects day to day, including creating them and following
  // the company activity feed. Review, lock, deletion and account/team control
  // remain supervisor responsibilities.
  user: [
    "project:create",
    "project:read",
    "project:update",
    "project:write",
    "activity:read",
    "dental:read",
    "dental:write",
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}
