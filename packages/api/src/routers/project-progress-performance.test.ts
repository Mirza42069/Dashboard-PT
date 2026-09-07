import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context } from "../context";
import { dictionaryFor } from "../lib/messages";

// Requires server env to load the routers, but all SQL execution is intercepted.
describe.skipIf(!process.env.DATABASE_URL)("project/progress query regressions", () => {
  let progressRouter: typeof import("./progress").progressRouter;
  let projectRouter: typeof import("./project").projectRouter;
  let restore: (() => void) | undefined;
  const ctx = (role = "admin") => ({
    headers: new Headers(), locale: "en", t: dictionaryFor("en"),
    session: { user: { id: "user-1", name: "Tester", role } },
    getCompanyId: async () => "company-1",
  }) as unknown as Context;

  beforeAll(async () => {
    ({ progressRouter } = await import("./progress"));
    ({ projectRouter } = await import("./project"));
  });
  afterEach(() => restore?.());

  function intercept(respond: (sql: string, params: unknown[]) => unknown[] | Promise<unknown[]>) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const prepare = (query: { sql: string; params: unknown[] }) => ({
      setToken() { return this; },
      execute: async () => {
        queries.push(query);
        return respond(query.sql, query.params);
      },
    });
    const spy = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation(
      prepare as unknown as typeof NeonHttpSession.prototype.prepareQuery,
    );
    restore = () => spy.mockRestore();
    return queries;
  }

  function reportRows(sql: string): unknown[] {
    if (sql.includes('from "project"')) return [{ companyId: "company-1", dataDate: null }];
    if (sql.includes('from "boq_version"')) return [{ id: "version-1", totalValue: "12.50" }];
    if (sql.includes('from "project_actual_curve"')) {
      return [{ periodId: "period-1", cumulativePercent: "25.00" }];
    }
    if (sql.includes('from "progress_entry"')) return [{
      boqItemId: "item-1", periodId: "period-1", cumulativeQuantity: null,
      cumulativePercent: "25.00", pctComplete: "25.00", noProgress: false, note: null,
    }];
    return [];
  }

  test("default report loads actuals and selects only the latest active version", async () => {
    const queries = intercept(reportRows);
    const result = await progressRouter.createCaller(ctx()).report({ projectId: "project-1" });
    expect(result.actualSnapshots).toEqual([{ periodId: "period-1", cumulativePercent: 25 }]);
    expect(result.entries[0]).toMatchObject({ cumulativeQuantity: null, cumulativePercent: 25 });
    const version = queries.find((q) => q.sql.includes('from "boq_version"'))!;
    expect(version.sql).toContain('"boq_version"."status" =');
    expect(version.sql).toContain('order by "boq_version"."version_no" desc limit');
    expect(version.params).toEqual(["project-1", "active", 1]);
  });

  test("planOnly skips both actuals queries and scopes an explicit version to the project", async () => {
    const queries = intercept(reportRows);
    const result = await progressRouter.createCaller(ctx()).report({
      projectId: "project-1", versionId: "draft-1", planOnly: true,
    });
    expect(result.entries).toEqual([]);
    expect(result.actualSnapshots).toEqual([]);
    expect(queries.some((q) => /from "(progress_entry|project_actual_curve)"/.test(q.sql))).toBe(false);
    expect(queries.find((q) => q.sql.includes('from "boq_version"'))?.params)
      .toEqual(["project-1", "draft-1", 1]);
    expect(queries.some((q) => q.sql.includes('from "boq_item_distribution"'))).toBe(true);
  });

  test("independent report reads start without waiting for project metadata", async () => {
    let release!: (rows: unknown[]) => void;
    const metadata = new Promise<unknown[]>((resolve) => { release = resolve; });
    const queries = intercept((sql) => sql.includes('"period_type"') ? metadata : reportRows(sql));
    const pending = progressRouter.createCaller(ctx()).report({ projectId: "project-1" });
    try {
      for (let i = 0; i < 100 && queries.length < 5; i++) await Promise.resolve();
      expect(queries.some((q) => q.sql.includes('from "boq_version"'))).toBe(true);
      expect(queries.some((q) => q.sql.includes('from "reporting_period"'))).toBe(true);
      expect(queries.some((q) => q.sql.includes('from "project_actual_curve"'))).toBe(true);
    } finally {
      release([{ dataDate: null }]);
      await pending;
    }
  });

  test("missing explicit versions still fail; no active version preserves snapshots", async () => {
    intercept((sql) => sql.includes('from "boq_version"') ? [] : reportRows(sql));
    const caller = progressRouter.createCaller(ctx());
    await expect(caller.report({ projectId: "project-1", versionId: "foreign-version" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await caller.report({ projectId: "project-1" });
    expect(result.version).toBeNull();
    expect(result.items).toEqual([]);
    expect(result.actualSnapshots).toHaveLength(1);
  });

  test("cross-company access stops before report reads", async () => {
    const queries = intercept(() => [{ companyId: "other-company" }]);
    await expect(progressRouter.createCaller(ctx()).report({ projectId: "project-1", planOnly: true }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queries).toHaveLength(1);
  });

  test("unassigned users cannot trigger report reads", async () => {
    const queries = intercept((sql) => sql.includes('from "project_member"') ? [] : reportRows(sql));
    await expect(progressRouter.createCaller(ctx("user")).report({ projectId: "project-1" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(queries).toHaveLength(2);
  });

  test("exceptions exclude inactive projects in SQL without dropping membership or archive scope", async () => {
    const queries = intercept(() => []);
    const result = await projectRouter.createCaller(ctx("user")).exceptions({ limit: 1 });
    expect(result.total).toBe(0);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('"project"."status" not in');
    expect(queries[0]!.sql).toContain('"project"."archived_at" is null');
    expect(queries[0]!.sql).toContain('"project_member"');
    expect(queries[0]!.params).toEqual(["company-1", "user-1", "completed", "cancelled"]);
  });

  test("exception pagination keeps global reason counts and worst-first ranking", async () => {
    intercept(() => [
      { projectId: "mild", code: "A", actual: "40", planned: "50", reportsDue: 2 },
      { projectId: "worst", code: "Z", actual: "10", planned: "50", reportsDue: 0 },
    ].map((row) => ({
      ...row, hiddenModules: [], hasBaseline: true, dataDate: "2026-09-01", reportAgeDays: 6,
      previousActual: null, workCompletedValue: null, reportsAwaitingReview: 1,
    })));
    const caller = projectRouter.createCaller(ctx());
    const first = await caller.exceptions({ filter: "behind", limit: 1 });
    expect(first.projects.map((p) => p.projectId)).toEqual(["worst"]);
    expect(first.counts).toMatchObject({ live: 2, behind: 2, reporting: 1, reportsDue: 2, awaitingReview: 2 });
    expect(first.total).toBe(2);
    expect(first.nextOffset).toBe(1);
    const second = await caller.exceptions({ filter: "behind", limit: 1, offset: 1 });
    expect(second.projects.map((p) => p.projectId)).toEqual(["mild"]);
    expect(second.counts).toEqual(first.counts);
    expect(second.nextOffset).toBeNull();
    const regular = await projectRouter.createCaller(ctx("user")).exceptions({ filter: "review" });
    expect(regular.counts.awaitingReview).toBe(0);
    expect(regular.projects).toEqual([]);
  });

  for (const action of ["archive", "restore", "delete"] as const) {
    test(`bulk ${action} writes all audit events in one insert`, async () => {
      const queries = intercept((sql) => {
        if (sql.startsWith("select") && sql.includes('from "project"')) return [
          { id: "p1", code: "A", name: "Alpha" }, { id: "p2", code: "B", name: "Beta" },
        ];
        return [];
      });
      const caller = projectRouter.createCaller(ctx());
      const result = action === "delete"
        ? await caller.deleteMany({ ids: ["p1", "p2", "foreign"], force: true })
        : await caller.setArchived({ ids: ["p1", "p2", "foreign"], archived: action === "archive" });
      expect(result.count).toBe(2);
      const inserts = queries.filter((q) => q.sql.startsWith('insert into "activity_log"'));
      expect(inserts).toHaveLength(1);
      expect(inserts[0]!.params).toContain("A - Alpha");
      expect(inserts[0]!.params).toContain("B - Beta");
      expect(inserts[0]!.params).not.toContain("foreign");
    });
  }
});
