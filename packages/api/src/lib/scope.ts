import { db } from "@DashboardV2/db";
import {
  company,
  project,
  projectMember,
  projectNote,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, exists, sql } from "drizzle-orm";

import { roleOf } from "./permissions";

/**
 * Company scoping.
 *
 * Every request resolves to exactly one company — there is no "all companies"
 * mode — so callers get a plain string and every query is a plain equality
 * filter. A regular user is pinned to `user.companyId`; an admin picks an
 * active company, carried in a cookie.
 */

/** Mirrors apps/web/src/lib/company.ts, which writes this cookie. */
export const COMPANY_COOKIE = "v2.company";

/** Minimal cookie lookup — the API only ever reads this one value. */
function readCookie(headers: Headers, name: string): string | undefined {
  const header = headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

export type SessionUser = { id: string; role?: string | null; companyId?: string | null };

/**
 * Resolves the company a request acts on.
 *
 * Shared by tRPC (via companyProcedure) and the Hono photo routes, which sit
 * outside tRPC but must apply exactly the same rule — hence one implementation.
 */
export async function resolveCompanyIdForSession(
  sessionUser: SessionUser,
  headers: Headers,
): Promise<string> {
  if (roleOf(sessionUser) !== "super_admin") {
    // admin and user are both pinned to one company now — only super_admin
    // gets the cross-tenant cookie-switcher below.
    if (!sessionUser.companyId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No company assigned to this account. Ask an admin to set one.",
      });
    }
    return sessionUser.companyId;
  }

  // Super admin: the cookie is a preference, not an authority — validate it
  // still names a real company before trusting it.
  const requested = readCookie(headers, COMPANY_COOKIE);
  if (requested) {
    const [found] = await db
      .select({ id: company.id })
      .from(company)
      .where(eq(company.id, requested));
    if (found) return found.id;
  }

  const [first] = await db
    .select({ id: company.id })
    .from(company)
    .orderBy(asc(company.createdAt))
    .limit(1);
  if (!first) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No companies exist yet. Create one under Admin → Companies.",
    });
  }
  return first.id;
}

/**
 * Guards for entities addressed by id.
 *
 * These throw NOT_FOUND rather than FORBIDDEN on a cross-company id on
 * purpose: FORBIDDEN would confirm to another tenant that the row exists.
 */

/** The subset of tRPC context every project-scoped guard/filter needs. */
export type ProjectScopeCtx = {
  companyId: string;
  session: { user: SessionUser };
};

/**
 * Company check for every role, plus a project_member check for role=user —
 * a User only ever sees the projects an admin assigned them to. NOT_FOUND
 * either way; a non-member must not learn the project exists.
 */
export async function assertProjectAccess(ctx: ProjectScopeCtx, projectId: string) {
  const [row] = await db
    .select({ companyId: project.companyId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(projectId, ctx.session.user.id, "Project not found");
  }
}

/**
 * Raw membership check for routers that resolve their own project id through
 * a join (tickets, notes, BoQ …) and just need the same "must be a member if
 * role=user" rule assertProjectAccess applies — call this only after
 * confirming `roleOf(ctx.session.user) === "user"`.
 */
export async function assertMember(projectId: string, userId: string, message: string) {
  const [member] = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
  if (!member) {
    throw new TRPCError({ code: "NOT_FOUND", message });
  }
}

/**
 * Drizzle condition for list queries: company equality for admin/super_admin,
 * plus a project_member EXISTS clause for role=user. Mirrors assertProjectAccess
 * so a list and a by-id lookup never disagree about what's visible.
 */
export function projectAccessFilter(ctx: ProjectScopeCtx) {
  const inCompany = eq(project.companyId, ctx.companyId);
  if (roleOf(ctx.session.user) !== "user") return inCompany;
  return and(
    inCompany,
    exists(
      db
        .select({ one: sql`1` })
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, project.id),
            eq(projectMember.userId, ctx.session.user.id),
          ),
        ),
    ),
  );
}

/** Notes carry no company of their own — scope comes from the parent project. */
export async function assertNoteAccess(ctx: ProjectScopeCtx, noteId: string) {
  const [row] = await db
    .select({ companyId: project.companyId, projectId: project.id })
    .from(projectNote)
    .innerJoin(project, eq(projectNote.projectId, project.id))
    .where(eq(projectNote.id, noteId));
  if (!row || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, "Note not found");
  }
}

/**
 * A user who may be named on this company's records — its own staff, or a
 * super_admin (unpinned, and legitimately assignable anywhere: admins are
 * pinned to one company now, so a plain companyId match already covers them).
 * Without this, an assigneeId or managerId from another tenant is stored and
 * then joined back, rendering that person's name — and, on project.get, their
 * email — inside a company that should never see them.
 */
export async function assertUserAssignable(companyId: string, userId: string) {
  const [row] = await db
    .select({ companyId: user.companyId, role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  if (!row || (row.role !== "super_admin" && row.companyId !== companyId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
}

/** Used by admin.createUser to reject a companyId that does not exist. */
export async function assertCompanyExists(companyId: string) {
  const [row] = await db.select({ id: company.id }).from(company).where(eq(company.id, companyId));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
  }
}
