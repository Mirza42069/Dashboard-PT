import { db } from "@DashboardV2/db";
import {
  PERIOD_TYPES,
  PROJECT_STATUSES,
  boqVersion,
  project,
  projectMember,
  ticket,
  user,
} from "@DashboardV2/db/schema";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, ilike, inArray, ne, notInArray, or, sql, sum } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import { runBatch } from "../lib/batch";
import { type BoqMetrics, boqMetricsByProject, projectExceptions } from "../lib/boq-metrics";
import { percentOf, toAmount } from "../lib/money";
import { roleOf } from "../lib/permissions";
import { assertProjectAccess, assertUserAssignable, projectAccessFilter } from "../lib/scope";

const statusSchema = z.enum(PROJECT_STATUSES);

/**
 * How long a project may go without a reading before the dashboard calls it
 * stale. Two weeks covers a missed weekly report and the week it takes someone
 * to notice; past that, silence is the finding.
 */
const STALE_AFTER_DAYS = 14;

/**
 * Every nullable column is `nullish()`, not `optional()`, and the difference is
 * load-bearing for `update`: because that input is `.partial()`, an absent key
 * has to keep meaning "leave this column alone", which leaves nothing to express
 * "empty this column" with. `null` is that word.
 *
 * Without it, clearing a project's client or manager in the edit dialog was
 * accepted, reported as saved, and silently discarded — the form sent
 * `undefined`, JSON dropped the key, and the column was never in the SET clause.
 *
 * For the same reason **no field here carries `.default()`**. `update` takes
 * this schema `.partial()`, and zod applies a default when a key is absent — so
 * a default is not "the value to use on create", it is "the value to overwrite
 * with on every edit that leaves the field out". `status`, `progress` and
 * `periodType` all had one, and the old edit dialog sent none of the last two:
 * every pencil-click quietly reset site progress to 0 and reporting cadence to
 * weekly. The three columns are `.notNull().default(...)` in the Drizzle schema,
 * so leaving them out of an insert still fills them in — the default belongs
 * there, once, where it cannot leak into an update.
 */
const upsertSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
  name: z.string().trim().min(1, "Name is required").max(200),
  client: z.string().trim().max(200).nullish(),
  location: z.string().trim().max(200).nullish(),
  status: statusSchema.optional(),
  // Plain calendar dates end to end — see the note in the schema file.
  startDate: z.iso.date().nullish(),
  endDate: z.iso.date().nullish(),
  progress: z.number().int().min(0).max(100).optional(),
  periodType: z.enum(PERIOD_TYPES).optional(),
  scheduleStart: z.iso.date().nullish(),
  managerId: z.string().min(1).nullish(),
  notes: z.string().max(2000).nullish(),
});

/** Tickets remain open until somebody explicitly closes them. */
async function openTicketsByProject(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({ projectId: ticket.projectId, open: count() })
    .from(ticket)
    .where(and(inArray(ticket.projectId, projectIds), sql`${ticket.status} <> 'closed'`))
    .groupBy(ticket.projectId);

  return new Map(rows.map((row) => [row.projectId, row.open]));
}

/**
 * `boq` is present only for projects with an active baseline. Everything else
 * keeps reporting the progress figure the PM typed in, so adding the BoQ module
 * changed nothing for projects that do not use it.
 */
function decorate(
  row: typeof project.$inferSelect,
  openTickets: number,
  boq?: BoqMetrics,
) {
  const contractValue = boq?.contractValue ?? null;
  const workCompletedValue = boq?.workCompletedValue ?? null;
  return {
    ...row,
    contractValue,
    workCompletedValue,
    remainingContractValue:
      contractValue === null || workCompletedValue === null
        ? null
        : contractValue - workCompletedValue,
    valueCompletionPercent:
      contractValue === null || workCompletedValue === null
        ? null
        : percentOf(workCompletedValue, contractValue),
    openTickets,
    /** The figure to show. Read this rather than `progress`. */
    progressPercent: boq ? boq.progress : row.progress,
    progressSource: boq ? ("boq" as const) : ("manual" as const),
    plannedPercent: boq?.planned ?? null,
    /** actual − planned. Negative is behind. Null when nothing is reported. */
    deviation: boq?.deviation ?? null,
    dataDate: boq?.dataDate ?? null,
  };
}

export const projectRouter = router({
  list: companyPermissionProcedure("project:read")
    .input(
      z.object({
        search: z.string().trim().max(200).default(""),
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        projectAccessFilter(ctx),
        input.search
          ? or(
              ilike(project.name, `%${input.search}%`),
              ilike(project.code, `%${input.search}%`),
              ilike(project.client, `%${input.search}%`),
            )
          : undefined,
        input.status ? eq(project.status, input.status) : undefined,
      ].filter(Boolean);
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(project)
          .where(where)
          .orderBy(desc(project.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        db.select({ value: count() }).from(project).where(where),
      ]);

      const ids = rows.map((row) => row.id);
      const [openTickets, boq] = await Promise.all([
        openTicketsByProject(ids),
        boqMetricsByProject(ids),
      ]);

      return {
        projects: rows.map((row) =>
          decorate(row, openTickets.get(row.id) ?? 0, boq.get(row.id)),
        ),
        total: total?.value ?? 0,
      };
    }),

  /** Lightweight list for the project pickers on other screens. */
  options: companyPermissionProcedure("project:read").query(async ({ ctx }) => {
    return db
      .select({ id: project.id, code: project.code, name: project.name, status: project.status })
      .from(project)
      .where(projectAccessFilter(ctx))
      .orderBy(asc(project.code));
  }),

  /**
   * Who can be named as a project manager: this company's own staff.
   *
   * Super admins are deliberately absent. The role is there to supervise every
   * company's data from outside all of them, so it must never appear in a
   * picker an admin or user reads — putting one in the list is how their name
   * and email end up printed on a project page. `assertUserAssignable` enforces
   * the same rule on write, so a hand-made request cannot get around the list.
   */
  managerOptions: companyProcedure.query(async ({ ctx }) => {
    return db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(
        and(
          eq(user.banned, false),
          eq(user.companyId, ctx.companyId),
          ne(user.role, "super_admin"),
        ),
      )
      .orderBy(asc(user.name));
  }),

  get: companyPermissionProcedure("project:read")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(project)
        .where(and(eq(project.id, input.id), projectAccessFilter(ctx)));
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [openTickets, boq, manager] = await Promise.all([
        openTicketsByProject([row.id]),
        boqMetricsByProject([row.id]),
        // The same guard `managerOptions` and the export apply, for the same
        // reason and on the surface where it matters most: a super admin can no
        // longer be assigned, but a row predating that rule would otherwise
        // print their name *and* email on a page every admin and assigned user
        // of the company reads. No row back means the project shows as
        // unmanaged, which is the truthful answer: nobody in this company
        // manages it.
        row.managerId
          ? db
              .select({ id: user.id, name: user.name, email: user.email })
              .from(user)
              .where(and(eq(user.id, row.managerId), ne(user.role, "super_admin")))
          : Promise.resolve([]),
      ]);

      return {
        ...decorate(row, openTickets.get(row.id) ?? 0, boq.get(row.id)),
        manager: manager[0] ?? null,
      };
    }),

  /**
   * Projects running behind their baseline, worst first. Only projects with an
   * active BoQ and at least one reading can be behind — everything else has no
   * plan to be measured against and is left out rather than shown as on track.
   */
  behindSchedule: companyPermissionProcedure("project:read")
    .input(z.object({ limit: z.number().int().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select({ id: project.id, code: project.code, name: project.name, client: project.client })
        .from(project)
        .where(projectAccessFilter(ctx));

      const metrics = await boqMetricsByProject(rows.map((row) => row.id));

      return rows
        .flatMap((row) => {
          const boq = metrics.get(row.id);
          if (!boq || boq.deviation === null || boq.deviation >= 0) return [];
          return [{ ...row, ...boq, deviation: boq.deviation }];
        })
        .sort((a, b) => a.deviation - b.deviation)
        .slice(0, input.limit);
    }),

  /**
   * The portfolio ranked by what needs attention, plus the counts behind the
   * dashboard's cards.
   *
   * Deliberately one procedure rather than a card-per-query: every figure here
   * is derived from the same set of projects, and splitting them would mean the
   * "3 reports due" tile and the list underneath it could disagree by a refetch.
   *
   * Ordering puts the worst deviation first, then projects that have gone quiet.
   * A project nobody has reported on has a null deviation and cannot be ranked
   * by it — but silence is itself the exception worth surfacing, which is what
   * `reportAgeDays` is for.
   */
  exceptions: companyPermissionProcedure("project:read")
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await projectExceptions(projectAccessFilter(ctx));

      // Cancelled and completed projects are not exceptions — nobody is going to
      // act on a variance from a job that finished.
      const live = rows.filter((row) => row.status !== "completed" && row.status !== "cancelled");

      const behind = live.filter((row) => row.deviation !== null && row.deviation < 0);
      const stale = live.filter((row) => row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS);
      const unreported = live.filter((row) => row.dataDate === null);

      const ranked = [...live].sort((a, b) => {
        const aBehind = a.deviation !== null && a.deviation < 0;
        const bBehind = b.deviation !== null && b.deviation < 0;
        if (aBehind !== bBehind) return aBehind ? -1 : 1;
        if (aBehind && bBehind) return (a.deviation ?? 0) - (b.deviation ?? 0);
        return (b.reportAgeDays ?? -1) - (a.reportAgeDays ?? -1);
      });

      return {
        counts: {
          live: live.length,
          behind: behind.length,
          stale: stale.length,
          unreported: unreported.length,
          reportsDue: live.reduce((total, row) => total + row.reportsDue, 0),
          awaitingReview: live.reduce((total, row) => total + row.reportsAwaitingReview, 0),
          openTickets: live.reduce((total, row) => total + row.openTickets, 0),
        },
        projects: ranked.slice(0, input?.limit ?? 10),
      };
    }),

  /** Everything the dashboard needs, in one round trip. */
  summary: companyPermissionProcedure("project:read").query(async ({ ctx }) => {
    const inCompany = projectAccessFilter(ctx);
    const [projectRows, [baselineTotal], [openTicketRow]] = await Promise.all([
      db
        .select({ id: project.id, status: project.status })
        .from(project)
        .where(inCompany),
      db
        .select({ total: sum(boqVersion.totalValue) })
        .from(boqVersion)
        .innerJoin(project, eq(project.id, boqVersion.projectId))
        .where(
          and(
            inCompany,
            eq(boqVersion.status, "active"),
            eq(boqVersion.scheduleStatus, "active"),
          ),
        ),
      db
        .select({ value: count() })
        .from(ticket)
        .innerJoin(project, eq(ticket.projectId, project.id))
        .where(and(inCompany, sql`${ticket.status} <> 'closed'`)),
    ]);

    const boq = await boqMetricsByProject(projectRows.map((row) => row.id));

    const byStatus = Object.fromEntries(
      PROJECT_STATUSES.map((status) => [
        status,
        projectRows.filter((row) => row.status === status).length,
      ]),
    ) as Record<(typeof PROJECT_STATUSES)[number], number>;

    const measured = [...boq.values()].filter(
      (metric): metric is BoqMetrics & { workCompletedValue: number } =>
        metric.workCompletedValue !== null,
    );
    const workCompletedValue =
      measured.length === 0
        ? null
        : measured.reduce((total, metric) => total + metric.workCompletedValue, 0);
    const portfolioValue = toAmount(baselineTotal?.total);

    return {
      projects: {
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
      },
      portfolioValue,
      workCompletedValue,
      valueCompletionPercent:
        workCompletedValue === null ? null : percentOf(workCompletedValue, portfolioValue),
      openTickets: openTicketRow?.value ?? 0,
    };
  }),

  create: companyPermissionProcedure("project:create").input(upsertSchema).mutation(async ({ ctx, input }) => {
    const code = input.code.toUpperCase();

    // Codes are unique per company, so the clash check is scoped too.
    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.code, code), eq(project.companyId, ctx.companyId)));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Project code ${code} is already in use` });
    }
    if (input.startDate && input.endDate && input.endDate < input.startDate) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
    }
    if (input.managerId) {
      await assertUserAssignable(ctx.companyId, input.managerId);
    }

    const projectId = crypto.randomUUID();
    await runBatch([
      db.insert(project).values({
        id: projectId,
        ...input,
        code,
        companyId: ctx.companyId,
      }),
      ...(roleOf(ctx.session.user) === "user"
        ? [db.insert(projectMember).values({ projectId, userId: ctx.session.user.id })]
        : []),
    ]);

    await recordActivity(ctx, {
      action: "created",
      entityType: "project",
      entityId: projectId,
      entityLabel: `${code} - ${input.name}`,
    });

    return { id: projectId };
  }),

  update: companyPermissionProcedure("project:update")
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id: projectId, code, ...rest } = input;

      await assertProjectAccess(ctx, projectId);
      const [current] = await db.select().from(project).where(eq(project.id, projectId));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // `??` would be wrong here now that null means "clear it": an explicit
      // null would fall through to the stored date and the check would compare
      // against a value the caller is in the middle of removing.
      const startDate = rest.startDate === undefined ? current.startDate : rest.startDate;
      const endDate = rest.endDate === undefined ? current.endDate : rest.endDate;
      if (startDate && endDate && endDate < startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End date is before the start date" });
      }
      // Only a *change* of manager is checked. The edit form resubmits whatever
      // is stored, so a project left over from when super admins were assignable
      // could not be saved at all: changing only its name re-sent the legacy
      // managerId, which `assertUserAssignable` now rejects with "User not
      // found" — naming nothing the user can see, since that manager is also
      // absent from the picker. Re-sending the value already in the column
      // changes nothing and is treated as such; assigning a new one is checked
      // as before.
      if (rest.managerId && rest.managerId !== current.managerId) {
        await assertUserAssignable(ctx.companyId, rest.managerId);
      }

      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: project.id })
          .from(project)
          .where(
            and(eq(project.code, code.toUpperCase()), eq(project.companyId, ctx.companyId)),
          );
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `Project code ${code} is already in use` });
        }
      }

      await db
        .update(project)
        .set({
          ...rest,
          ...(code ? { code: code.toUpperCase() } : {}),
        })
        .where(eq(project.id, projectId));

      // create, delete and setMembers all record themselves; this one did not,
      // so editing a project was the one change to a project that left no trail.
      await recordActivity(ctx, {
        action: "updated",
        entityType: "project",
        entityId: projectId,
        entityLabel: `${code?.toUpperCase() ?? current.code} - ${rest.name ?? current.name}`,
      });

      return { success: true };
    }),

  /**
   * Tickets cascade, but that is a lot of history to lose by accident, so
   * deleting a project with tickets requires an explicit confirm.
   */
  delete: companyPermissionProcedure("project:delete")
    .input(z.object({ id: z.string().min(1), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      // Read the label before deleting — after the row is gone there is nothing
      // left to name it with, and that is the row the audit trail most needs.
      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(and(eq(project.id, input.id), eq(project.companyId, ctx.companyId)));
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      const [tickets] = await db
        .select({ value: count() })
        .from(ticket)
        .where(eq(ticket.projectId, input.id));

      const ticketCount = tickets?.value ?? 0;

      if (!input.force && ticketCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This project has ${ticketCount} ticket(s), which will be deleted with it. Confirm to continue.`,
        });
      }

      await db.delete(project).where(eq(project.id, input.id));

      await recordActivity(ctx, {
        action: "deleted",
        entityType: "project",
        entityId: input.id,
        entityLabel: `${target.code} - ${target.name}`,
      });

      return { success: true, deletedTickets: ticketCount };
    }),

  /**
   * Bulk counterpart of delete. Scoping shares the where clause with the id
   * filter so a cross-tenant id is simply not matched.
   */
  deleteMany: companyPermissionProcedure("project:delete")
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const targets = await db
        .select({ id: project.id, code: project.code, name: project.name })
        .from(project)
        .where(and(inArray(project.id, input.ids), eq(project.companyId, ctx.companyId)));
      if (targets.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No projects found" });
      }

      const ids = targets.map((row) => row.id);

      const [tickets] = await db
        .select({ value: count() })
        .from(ticket)
        .where(inArray(ticket.projectId, ids));

      const ticketCount = tickets?.value ?? 0;

      if (!input.force && ticketCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `These projects have ${ticketCount} ticket(s), which will be deleted with them. Confirm to continue.`,
        });
      }

      await db.delete(project).where(inArray(project.id, ids));

      for (const target of targets) {
        await recordActivity(ctx, {
          action: "deleted",
          entityType: "project",
          entityId: target.id,
          entityLabel: `${target.code} - ${target.name}`,
        });
      }

      return {
        success: true,
        count: targets.length,
        deletedTickets: ticketCount,
      };
    }),

  /** Who currently sees this project — for the project's Team tab. */
  listMembers: companyPermissionProcedure("member:manage")
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);
      return db
        .select({ id: user.id, name: user.name, email: user.email })
        .from(projectMember)
        .innerJoin(user, eq(user.id, projectMember.userId))
        .where(eq(projectMember.projectId, input.projectId))
        .orderBy(asc(user.name));
    }),

  /** Company Users eligible to be assigned to a project — feeds the picker. */
  memberOptions: companyPermissionProcedure("member:manage").query(async ({ ctx }) => {
    return db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(user)
      .where(and(eq(user.companyId, ctx.companyId), eq(user.role, "user"), eq(user.banned, false)))
      .orderBy(asc(user.name));
  }),

  /**
   * Replaces a project's member list wholesale. Two idempotent statements
   * rather than a read-diff-write — the Neon HTTP driver has no interactive
   * transactions, so delete-then-insert is what keeps a partial failure a
   * subset of the intended result, never a superset.
   */
  setMembers: companyPermissionProcedure("member:manage")
    .input(z.object({ projectId: z.string().min(1), userIds: z.array(z.string().min(1)).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId);

      const uniqueIds = [...new Set(input.userIds)];
      if (uniqueIds.length > 0) {
        const eligible = await db
          .select({ id: user.id })
          .from(user)
          .where(
            and(
              inArray(user.id, uniqueIds),
              eq(user.companyId, ctx.companyId),
              eq(user.role, "user"),
            ),
          );
        if (eligible.length !== uniqueIds.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: "One or more users were not found" });
        }
      }

      await db
        .delete(projectMember)
        .where(
          uniqueIds.length > 0
            ? and(
                eq(projectMember.projectId, input.projectId),
                notInArray(projectMember.userId, uniqueIds),
              )
            : eq(projectMember.projectId, input.projectId),
        );

      if (uniqueIds.length > 0) {
        await db
          .insert(projectMember)
          .values(uniqueIds.map((userId) => ({ projectId: input.projectId, userId })))
          .onConflictDoNothing();
      }

      const [target] = await db
        .select({ code: project.code, name: project.name })
        .from(project)
        .where(eq(project.id, input.projectId));
      if (target) {
        await recordActivity(ctx, {
          action: "assigned",
          entityType: "project",
          entityId: input.projectId,
          entityLabel: `${target.code} - ${target.name}`,
          detail: `${uniqueIds.length} member(s)`,
        });
      }

      return { success: true };
    }),
});
