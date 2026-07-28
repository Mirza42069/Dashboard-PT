import { db } from "@DashboardV2/db";
import {
  company,
  equipment,
  material,
  project,
  projectNote,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { asc, eq } from "drizzle-orm";

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
  if (sessionUser.role !== "admin") {
    if (!sessionUser.companyId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "No company assigned to this account. Ask an admin to set one.",
      });
    }
    return sessionUser.companyId;
  }

  // Admin: the cookie is a preference, not an authority — validate it still
  // names a real company before trusting it.
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
export async function assertProjectInScope(companyId: string, projectId: string) {
  const [row] = await db
    .select({ companyId: project.companyId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row || row.companyId !== companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
}

export async function assertMaterialInScope(companyId: string, materialId: string) {
  const [row] = await db
    .select({ companyId: material.companyId })
    .from(material)
    .where(eq(material.id, materialId));
  if (!row || row.companyId !== companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Material not found" });
  }
}

export async function assertEquipmentInScope(companyId: string, equipmentId: string) {
  const [row] = await db
    .select({ companyId: equipment.companyId })
    .from(equipment)
    .where(eq(equipment.id, equipmentId));
  if (!row || row.companyId !== companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Equipment not found" });
  }
}

/** Notes carry no company of their own — scope comes from the parent project. */
export async function assertNoteInScope(companyId: string, noteId: string) {
  const [row] = await db
    .select({ companyId: project.companyId })
    .from(projectNote)
    .innerJoin(project, eq(projectNote.projectId, project.id))
    .where(eq(projectNote.id, noteId));
  if (!row || row.companyId !== companyId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Note not found" });
  }
}

/**
 * A user who may be named on this company's records — its own staff, or an
 * admin (unpinned, and legitimately assignable anywhere). Without this, an
 * assigneeId or managerId from another tenant is stored and then joined back,
 * rendering that person's name — and, on project.get, their email — inside a
 * company that should never see them.
 */
export async function assertUserAssignable(companyId: string, userId: string) {
  const [row] = await db
    .select({ companyId: user.companyId, role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  if (!row || (row.role !== "admin" && row.companyId !== companyId)) {
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

/** The company a given user is pinned to, for admin-facing user listings. */
export async function getUserCompanyId(userId: string) {
  const [row] = await db.select({ companyId: user.companyId }).from(user).where(eq(user.id, userId));
  return row?.companyId ?? null;
}
