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
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, notInArray, or, sql, sum } from "drizzle-orm";
import z from "zod";

import { companyPermissionProcedure, companyProcedure, router } from "../index";
import { recordActivity } from "../lib/activity";
import {
  createdAtCursorCondition,
  createdAtCursorSchema,
  exactCursorTimestamp,
} from "../lib/created-at-cursor";
import { isBehindDeviation } from "../lib/deviation";
import { runBatch } from "../lib/batch";
import { type BoqMetrics, boqMetricsByProject, projectExceptions } from "../lib/boq-metrics";
import { interpolate, type MessageDictionary, plural } from "../lib/messages/index";
import { percentOf, toAmount } from "../lib/money";
import { hasPermission, roleOf } from "../lib/permissions";
import {
  PROJECT_MODULE_KEYS,
  normalizeHiddenProjectModules,
} from "../lib/project-modules";
import { canAssignProjectManager, projectMembershipIds } from "../lib/project-manager";
import {
  assertProjectAccess,
  assertProjectWritable,
  assertUserAssignable,
  liveProjectsOnly,
  projectAccessFilter,
} from "../lib/scope";

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
  /**
   * `periodLengthDays` is deliberately NOT writable here.
   *
   * A custom cadence is a pair — the type and its cycle length — and letting
   * two routers set the halves independently is how the pair ends up
   * inconsistent. `schedule.updateSettings` owns both together and nulls the
   * length whenever the cadence is not custom; the create and update mutations
   * below refuse "custom" and point at it.
   */
  periodType: z.enum(PERIOD_TYPES).optional(),
  scheduleStart: z.iso.date().nullish(),
  managerId: z.string().min(1).nullish(),
  notes: z.string().max(2000).nullish(),
});

const createSchema = upsertSchema.omit({ status: true, progress: true });

/**
 * A custom cadence carries a cycle length this router has no field for, so it
 * can only be set where both halves are set together.
 */
const customCadenceElsewhere = (t: MessageDictionary) =>
  new TRPCError({
    code: "BAD_REQUEST",
    message: t.project.cadenceFromTiming,
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
    hiddenModules: normalizeHiddenProjectModules(row.hiddenModules),
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
        /** The Archive page. Everything else wants live projects only. */
        archived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: createdAtCursorSchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        projectAccessFilter(ctx),
        input.archived ? isNotNull(project.archivedAt) : liveProjectsOnly,
        input.search
          ? or(
              ilike(project.name, `%${input.search}%`),
              ilike(project.code, `%${input.search}%`),
              ilike(project.client, `%${input.search}%`),
            )
          : undefined,
        input.status ? eq(project.status, input.status) : undefined,
      ];
      const filteredWhere = and(...filters);

      const where = and(
        filteredWhere,
        input.cursor
          ? createdAtCursorCondition(project.createdAt, project.id, input.cursor)
          : undefined,
      );

      const [rows, [total]] = await Promise.all([
        db
          .select({
            row: project,
            cursorCreatedAt: exactCursorTimestamp(project.createdAt),
          })
          .from(project)
          .where(where)
          .orderBy(desc(project.createdAt), desc(project.id))
          .limit(input.limit + 1),
        input.cursor
          ? Promise.resolve([])
          : db.select({ value: count() }).from(project).where(filteredWhere),
      ]);

      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const ids = page.map(({ row }) => row.id);
      const [openTickets, boq] = await Promise.all([
        openTicketsByProject(ids),
        boqMetricsByProject(ids),
      ]);

      return {
        projects: page.map(({ row }) =>
          decorate(row, openTickets.get(row.id) ?? 0, boq.get(row.id)),
        ),
        total: total?.value ?? null,
        nextCursor: hasMore && page.length > 0
          ? {
              createdAt: page[page.length - 1]!.cursorCreatedAt,
              id: page[page.length - 1]!.row.id,
            }
          : null,
      };
    }),

  /** Lightweight list for the project pickers on other screens. */
  options: companyPermissionProcedure("project:read").query(async ({ ctx }) => {
    return db
      .select({ id: project.id, code: project.code, name: project.name, status: project.status })
      .from(project)
      .where(and(projectAccessFilter(ctx), liveProjectsOnly))
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
          inArray(user.role, ["admin", "user"]),
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
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
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
              .where(
                and(
                  eq(user.id, row.managerId),
                  eq(user.banned, false),
                  eq(user.companyId, row.companyId),
                  inArray(user.role, ["admin", "user"]),
                ),
              )
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
        .where(and(projectAccessFilter(ctx), liveProjectsOnly));

      const metrics = await boqMetricsByProject(rows.map((row) => row.id));

      return rows
        .flatMap((row) => {
          const boq = metrics.get(row.id);
          if (!boq || !isBehindDeviation(boq.deviation)) return [];
          return [{ ...row, ...boq, deviation: boq.deviation }];
        })
        .sort((a, b) => (a.deviation ?? 0) - (b.deviation ?? 0))
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
    .input(
      z
        .object({
          filter: z.enum(["all", "behind", "reporting", "review", "actions"]).default("all"),
          limit: z.number().int().min(1).max(100).default(25),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { filter, limit, offset } = {
        filter: input?.filter ?? ("all" as const),
        limit: input?.limit ?? 25,
        offset: input?.offset ?? 0,
      };
      const rows = await projectExceptions(and(projectAccessFilter(ctx), liveProjectsOnly));
      const canReview = hasPermission(roleOf(ctx.session.user), "progress:review");

      // Cancelled and completed projects are not exceptions — nobody is going to
      // act on a variance from a job that finished.
      const live = rows.filter((row) => row.status !== "completed" && row.status !== "cancelled");

      const behind = live.filter((row) => isBehindDeviation(row.deviation));
      const stale = live.filter(
        (row) => row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS,
      );
      const unreported = live.filter((row) => row.hasBaseline && row.dataDate === null);
      const reporting = live.filter(
        (row) =>
          (row.hasBaseline && row.dataDate === null) ||
          (row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS) ||
          row.reportsDue > 0,
      );
      const needsAttention = live.filter(
        (row) =>
          isBehindDeviation(row.deviation) ||
          row.dataDate === null ||
          (row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS) ||
          row.reportsDue > 0 ||
          (canReview && row.reportsAwaitingReview > 0) ||
          row.openTickets > 0,
      );
      const ranked = [...needsAttention].sort((a, b) => {
        const aBehind = isBehindDeviation(a.deviation);
        const bBehind = isBehindDeviation(b.deviation);
        if (aBehind !== bBehind) return aBehind ? -1 : 1;
        if (aBehind && bBehind) return (a.deviation ?? 0) - (b.deviation ?? 0);
        const reportingDifference = b.reportsDue - a.reportsDue;
        if (reportingDifference !== 0) return reportingDifference;
        const ageDifference = (b.reportAgeDays ?? -1) - (a.reportAgeDays ?? -1);
        if (ageDifference !== 0) return ageDifference;
        return a.code.localeCompare(b.code);
      });

      const withReasons = ranked.map((row) => ({
        ...row,
        reasons: {
          behind: isBehindDeviation(row.deviation),
          baselineMissing: !row.hasBaseline,
          unreported: row.hasBaseline && row.dataDate === null,
          stale: row.reportAgeDays !== null && row.reportAgeDays > STALE_AFTER_DAYS,
          reportsDue: row.reportsDue > 0,
          awaitingReview: canReview && row.reportsAwaitingReview > 0,
          openActions: row.openTickets > 0,
        },
      }));
      const filtered = withReasons.filter((row) => {
        if (filter === "behind") return row.reasons.behind;
        if (filter === "reporting") {
          return row.reasons.unreported || row.reasons.stale || row.reasons.reportsDue;
        }
        if (filter === "review") return row.reasons.awaitingReview;
        if (filter === "actions") return row.reasons.openActions;
        return true;
      });
      const projects = filtered.slice(offset, offset + limit);
      const nextOffset = offset + projects.length < filtered.length
        ? offset + projects.length
        : null;

      return {
        counts: {
          live: live.length,
          behind: behind.length,
          stale: stale.length,
          unreported: unreported.length,
          reporting: reporting.length,
          reportsDue: live.reduce((total, row) => total + row.reportsDue, 0),
          awaitingReview: live.filter((row) => canReview && row.reportsAwaitingReview > 0).length,
          openTickets: live.filter((row) => row.openTickets > 0).length,
        },
        total: filtered.length,
        projects,
        nextOffset,
      };
    }),

  /** Everything the dashboard needs, in one round trip. */
  summary: companyPermissionProcedure("project:read").query(async ({ ctx }) => {
    // Archived projects are out of the portfolio for counting purposes — the
    // dashboard answers "what am I running", not "what have I ever run".
    const inCompany = and(projectAccessFilter(ctx), liveProjectsOnly);
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
        baselined: boq.size,
        measured: measured.length,
      },
      portfolioValue,
      workCompletedValue,
      valueCompletionPercent:
        workCompletedValue === null ? null : percentOf(workCompletedValue, portfolioValue),
      openTickets: openTicketRow?.value ?? 0,
    };
  }),

  codeAvailability: companyPermissionProcedure("project:create")
    .input(z.object({ code: upsertSchema.shape.code }))
    .query(async ({ ctx, input }) => {
      const code = input.code.toUpperCase();
      const [existing] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.code, code), eq(project.companyId, ctx.companyId)))
        .limit(1);

      return { available: !existing };
    }),

  create: companyPermissionProcedure("project:create")
    .input(createSchema)
    .mutation(async ({ ctx, input }) => {
      const code = input.code.toUpperCase();
      const actorRole = roleOf(ctx.session.user);

      // Codes are unique per company, so the clash check is scoped too.
      const [existing] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.code, code), eq(project.companyId, ctx.companyId)));
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: interpolate(ctx.t.project.codeInUse, { code }),
        });
      }
      if (input.startDate && input.endDate && input.endDate < input.startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.project.endBeforeStart });
      }
      if (input.periodType === "custom") throw customCadenceElsewhere(ctx.t);
      const manager = input.managerId
        ? { id: input.managerId, ...(await assertUserAssignable(ctx.t, ctx.companyId, input.managerId)) }
        : null;
      if (
        !canAssignProjectManager({
          actorId: ctx.session.user.id,
          canManageMembers: hasPermission(actorRole, "member:manage"),
          currentManagerId: null,
          nextManagerId: input.managerId ?? null,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: ctx.t.project.cannotAssignManager,
        });
      }

      const projectId = crypto.randomUUID();
      const membershipIds = projectMembershipIds({
        creatorId: ctx.session.user.id,
        creatorRole: actorRole,
        manager,
      });
      await runBatch([
        db.insert(project).values({
          id: projectId,
          ...input,
          code,
          companyId: ctx.companyId,
          progress: 0,
          status: "planning",
        }),
        ...(membershipIds.length > 0
          ? [
              db
                .insert(projectMember)
                .values(membershipIds.map((userId) => ({ projectId, userId })))
                .onConflictDoNothing(),
            ]
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

      await assertProjectWritable(ctx, projectId);
      const [current] = await db.select().from(project).where(eq(project.id, projectId));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
      }

      // `??` would be wrong here now that null means "clear it": an explicit
      // null would fall through to the stored date and the check would compare
      // against a value the caller is in the middle of removing.
      const startDate = rest.startDate === undefined ? current.startDate : rest.startDate;
      const endDate = rest.endDate === undefined ? current.endDate : rest.endDate;
      if (startDate && endDate && endDate < startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: ctx.t.project.endBeforeStart });
      }
      if (rest.periodType === "custom") throw customCadenceElsewhere(ctx.t);
      // Only a *change* of manager is checked. The edit form resubmits whatever
      // is stored, so a project left over from when super admins were assignable
      // could not be saved at all: changing only its name re-sent the legacy
      // managerId, which `assertUserAssignable` now rejects with "User not
      // found" — naming nothing the user can see, since that manager is also
      // absent from the picker. Re-sending the value already in the column
      // changes nothing and is treated as such; assigning a new one is checked
      // as before.
      let nextManagerRole: "admin" | "user" | null = null;
      if (rest.managerId !== undefined && rest.managerId !== current.managerId) {
        if (
          !canAssignProjectManager({
            actorId: ctx.session.user.id,
            canManageMembers: hasPermission(roleOf(ctx.session.user), "member:manage"),
            currentManagerId: current.managerId,
            nextManagerId: rest.managerId,
          })
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: ctx.t.project.cannotAssignManager,
          });
        }
        if (rest.managerId) {
          nextManagerRole = (await assertUserAssignable(ctx.t, ctx.companyId, rest.managerId)).role;
        }
      }

      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: project.id })
          .from(project)
          .where(
            and(eq(project.code, code.toUpperCase()), eq(project.companyId, ctx.companyId)),
          );
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: interpolate(ctx.t.project.codeInUse, { code }) });
        }
      }

      await runBatch([
        // Workbook commits use the same transaction-scoped lock. Keeping all
        // project edits behind it prevents a calendar edit from landing between
        // a workbook's final state guard and its writes.
        db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`),
        db
          .update(project)
          .set({
            ...rest,
            ...(code ? { code: code.toUpperCase() } : {}),
          })
          .where(eq(project.id, projectId)),
        ...(rest.managerId && nextManagerRole === "user"
          ? [
              db
                .insert(projectMember)
                .values({ projectId, userId: rest.managerId })
                .onConflictDoNothing(),
            ]
          : []),
      ]);

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

  setHiddenModules: companyPermissionProcedure("project:update")
    .input(
      z.object({
        projectId: z.string().min(1),
        hiddenModules: z.array(z.enum(PROJECT_MODULE_KEYS)).max(PROJECT_MODULE_KEYS.length),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectWritable(ctx, input.projectId);
      const [current] = await db
        .select({
          code: project.code,
          name: project.name,
          hiddenModules: project.hiddenModules,
        })
        .from(project)
        .where(and(eq(project.id, input.projectId), eq(project.companyId, ctx.companyId)));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
      }

      const previous = normalizeHiddenProjectModules(current.hiddenModules);
      const hiddenModules = normalizeHiddenProjectModules(input.hiddenModules);
      if (previous.join("|") === hiddenModules.join("|")) {
        return { changed: false, hiddenModules };
      }

      await db
        .update(project)
        .set({ hiddenModules })
        .where(and(eq(project.id, input.projectId), eq(project.companyId, ctx.companyId)));
      await recordActivity(ctx, {
        action: "visibility_changed",
        entityType: "project",
        entityId: input.projectId,
        entityLabel: `${current.code} - ${current.name}`,
        detail: hiddenModules.join(",") || "none",
      });

      return { changed: true, hiddenModules };
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
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.notFound });
      }

      const [tickets] = await db
        .select({ value: count() })
        .from(ticket)
        .where(eq(ticket.projectId, input.id));

      const ticketCount = tickets?.value ?? 0;

      if (!input.force && ticketCount > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: plural(ctx.t.project.deleteHasTickets, ticketCount),
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
  /**
   * File a project away, or bring it back.
   *
   * Bulk because the list it is driven from is a bulk-selection table, and one
   * statement for thirty projects rather than thirty round trips.
   *
   * Gated on `project:delete` rather than `project:write`: archiving is what
   * someone reaches for *instead of* deleting, so the two belong to the same
   * person. It writes only `archivedAt` — the project's status, dates and every
   * figure it recorded are left exactly as they were, which is the whole reason
   * this is a timestamp and not a sixth status.
   */
  setArchived: companyPermissionProcedure("project:delete")
    .input(
      z.object({
        ids: z.array(z.string().min(1)).min(1).max(100),
        archived: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Scoped in the same statement as the id filter, like deleteMany: an id
      // from another company is simply not matched, never reported as refused.
      const targets = await db
        .select({ id: project.id, code: project.code, name: project.name })
        .from(project)
        .where(and(inArray(project.id, input.ids), eq(project.companyId, ctx.companyId)));
      if (targets.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.noneFound });
      }

      const ids = targets.map((row) => row.id);
      await db
        .update(project)
        .set({ archivedAt: input.archived ? new Date() : null })
        .where(inArray(project.id, ids));

      for (const target of targets) {
        await recordActivity(ctx, {
          action: input.archived ? "archived" : "restored",
          entityType: "project",
          entityId: target.id,
          entityLabel: `${target.code} - ${target.name}`,
        });
      }

      return { success: true, count: targets.length };
    }),

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
        throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.project.noneFound });
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
          message: plural(ctx.t.project.bulkDeleteHasTickets, ticketCount),
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
   * rather than a read-diff-write. They run in one Neon batch so the replacement
   * is atomic, and the active regular-user manager is always retained.
   */
  setMembers: companyPermissionProcedure("member:manage")
    .input(z.object({ projectId: z.string().min(1), userIds: z.array(z.string().min(1)).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectWritable(ctx, input.projectId);

      const [managedProject] = await db
        .select({
          managerBanned: user.banned,
          managerCompanyId: user.companyId,
          managerId: project.managerId,
          managerRole: user.role,
        })
        .from(project)
        .leftJoin(user, eq(project.managerId, user.id))
        .where(eq(project.id, input.projectId));

      const effectiveIds = new Set(input.userIds);
      if (
        managedProject?.managerId &&
        managedProject.managerRole === "user" &&
        managedProject.managerCompanyId === ctx.companyId &&
        managedProject.managerBanned === false
      ) {
        effectiveIds.add(managedProject.managerId);
      }
      const uniqueIds = [...effectiveIds];
      if (uniqueIds.length > 0) {
        const eligible = await db
          .select({ id: user.id })
          .from(user)
          .where(
            and(
              inArray(user.id, uniqueIds),
              eq(user.companyId, ctx.companyId),
              eq(user.role, "user"),
              eq(user.banned, false),
            ),
          );
        if (eligible.length !== uniqueIds.length) {
          throw new TRPCError({ code: "NOT_FOUND", message: ctx.t.user.someNotFound });
        }
      }

      await runBatch([
        db
          .delete(projectMember)
          .where(
            uniqueIds.length > 0
              ? and(
                  eq(projectMember.projectId, input.projectId),
                  notInArray(projectMember.userId, uniqueIds),
                )
              : eq(projectMember.projectId, input.projectId),
          ),
        ...(uniqueIds.length > 0
          ? [
              db
                .insert(projectMember)
                .values(uniqueIds.map((userId) => ({ projectId: input.projectId, userId })))
                .onConflictDoNothing(),
            ]
          : []),
      ]);

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
