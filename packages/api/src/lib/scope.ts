import { db } from "@DashboardV2/db";
import {
  company,
  project,
  projectMember,
  projectNote,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, exists, isNull, sql } from "drizzle-orm";

import { assertNotArchived } from "./archived";
import { readCookie } from "./cookies";
import { type MessageDictionary, tFor } from "./messages/index";
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
  const t = tFor(headers);
  if (roleOf(sessionUser) !== "super_admin") {
    // admin and user are both pinned to one company now — only super_admin
    // gets the cross-tenant cookie-switcher below.
    if (!sessionUser.companyId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: t.auth.noCompanyAssigned,
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
      message: t.auth.noCompaniesYet,
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

/**
 * What a *query* needs: who is asking, and on whose behalf. No copy, because a
 * filter never refuses — it just narrows. apps/server builds one of these from
 * a session alone (the selected-project export route in index.ts), which
 * is why this half exists separately from the one below.
 */
export type ProjectScopeQuery = {
  companyId: string;
  session: { user: SessionUser };
};

/** What a *guard* needs: the query scope, plus the language to refuse in. */
export type ProjectScopeCtx = ProjectScopeQuery & { t: MessageDictionary };

/**
 * Live projects only. `and()` this into any list that should not show the archive.
 *
 * Deliberately separate from `projectAccessFilter` rather than folded into it.
 * That function answers "may this person see this project"; whether a project
 * has been filed away is a different question with a different answer — and
 * `project.get` needs the first without the second, or the Archive list would
 * link to a 404.
 */
export const liveProjectsOnly = isNull(project.archivedAt);

/** Re-exported so callers have one import for the project guards. */
export { assertNotArchived };

/**
 * Company check for every role, plus a project_member check for role=user —
 * a User only ever sees the projects an admin assigned them to. NOT_FOUND
 * either way; a non-member must not learn the project exists.
 */
export async function assertProjectAccess(ctx: ProjectScopeCtx, projectId: string) {
  const [row] = await db
    .select({ companyId: project.companyId, archivedAt: project.archivedAt })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(projectId, ctx.session.user.id, ctx.t.project.notFound);
  }
  return row;
}

/**
 * `assertProjectAccess` plus "and it is not archived". For mutations.
 *
 * A separately named function rather than a `{ write: true }` argument on the
 * one above, because the whole read-only rule rests on ~30 call sites choosing
 * correctly: a wrong *name* is visible in a diff, a missing argument is not.
 * Queries keep the read variant — an archived project must stay readable.
 */
export async function assertProjectWritable(ctx: ProjectScopeCtx, projectId: string) {
  const row = await assertProjectAccess(ctx, projectId);
  assertNotArchived(ctx.t, row.archivedAt);
  return row;
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
export function projectAccessFilter(ctx: ProjectScopeQuery) {
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
    .select({
      companyId: project.companyId,
      projectId: project.id,
      archivedAt: project.archivedAt,
    })
    .from(projectNote)
    .innerJoin(project, eq(projectNote.projectId, project.id))
    .where(eq(projectNote.id, noteId));
  if (!row || row.companyId !== ctx.companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.note.notFound });
  }
  if (roleOf(ctx.session.user) === "user") {
    await assertMember(row.projectId, ctx.session.user.id, ctx.t.note.notFound);
  }
  return row;
}

/** `assertNoteAccess` plus the archived gate. See `assertProjectWritable`. */
export async function assertNoteWritable(ctx: ProjectScopeCtx, noteId: string) {
  const row = await assertNoteAccess(ctx, noteId);
  assertNotArchived(ctx.t, row.archivedAt, "note");
  return row;
}

/**
 * A user who may be named on this company's records: its own staff, and nobody
 * else. Without this, an assigneeId or managerId from another tenant is stored
 * and then joined back, rendering that person's name — and, on project.get,
 * their email — inside a company that should never see them.
 *
 * Super admins are excluded, which is the point rather than an omission. The
 * role exists to supervise every company's data without being part of any of
 * them, so naming one as a project manager is what puts their name and address
 * on a project page that admins and users read. They are unpinned
 * (`companyId` is null), so the company check would reject them anyway — the
 * explicit role test is here so the intent survives someone later deciding to
 * give the account a companyId.
 */
export async function assertUserAssignable(
  t: MessageDictionary,
  companyId: string,
  userId: string,
): Promise<{ role: "admin" | "user" }> {
  const [row] = await db
    .select({ banned: user.banned, companyId: user.companyId, role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  if (
    !row ||
    row.banned ||
    row.companyId !== companyId ||
    (row.role !== "admin" && row.role !== "user")
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: t.user.notFound });
  }
  return { role: row.role as "admin" | "user" };
}

/** Used by admin.createUser to reject a companyId that does not exist. */
export async function assertCompanyExists(t: MessageDictionary, companyId: string) {
  const [row] = await db.select({ id: company.id }).from(company).where(eq(company.id, companyId));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: t.company.notFound });
  }
}
