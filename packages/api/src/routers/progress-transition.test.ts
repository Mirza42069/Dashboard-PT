import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context } from "../context";
import { dictionaryFor } from "../lib/messages";

// Router imports require server env; all SQL execution is intercepted.
describe.skipIf(!process.env.DATABASE_URL)("progress period writes", () => {
  let progressRouter: typeof import("./progress").progressRouter;
  const restores: (() => void)[] = [];
  const t = dictionaryFor("en");
  const ctx = {
    headers: new Headers(), locale: "en", t,
    session: { user: { id: "user-1", name: "Tester", role: "admin" } },
    getCompanyId: async () => "company-1",
  } as unknown as Context;
  const token = "2026-09-09 12:34:56.123456";

  beforeAll(async () => { ({ progressRouter } = await import("./progress")); });
  afterEach(() => { for (const restore of restores.splice(0)) restore(); });

  function intercept(options: { currentToken?: string; missing?: boolean; marked?: number | null; empty?: boolean } = {}) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const batches: number[] = [];
    const prepare = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => {
        queries.push(query);
        const { sql, params } = query;
        if (sql.includes('from "reporting_period"')) return [{
          id: "period-1", projectId: "project-1", periodIndex: 1, label: "Week 1",
          status: "draft", updatedAt: new Date("2026-09-09T12:34:56.123Z"), updatedAtToken: token,
        }];
        if (sql.includes('from "project"')) return [{ companyId: "company-1", archivedAt: null, code: "P1", name: "Project" }];
        if (sql.includes('from "boq_version"')) return [{ id: "version-1" }];
        if (sql.includes('from "boq_item"')) return options.empty ? [] : [{ id: "item-1" }];
        if (sql.includes('from "progress_entry"')) return options.missing ? [] : [{
          boqItemId: "item-1", noProgress: true, cumulativeQuantity: null, cumulativePercent: null,
        }];
        if (sql.includes("with changed as")) {
          // Simulate the exact DB equality, including changes within one JS millisecond.
          const parameter = /updated_at = \$(\d+)::timestamp/.exec(sql);
          const matches = parameter && params[Number(parameter[1]) - 1] === (options.currentToken ?? token);
          return { rows: matches ? [{ id: "event-1" }] : [] };
        }
        if (sql.includes("with input_rows")) return {
          rows: options.marked === null ? [] : [{ marked: options.marked ?? 1 }],
        };
        return [];
      },
    }) as never);
    const batch = spyOn(NeonHttpSession.prototype, "batch").mockImplementation((async (
      statements: { _prepare(): { execute(): Promise<unknown> } }[],
    ) => {
      batches.push(statements.length);
      const results = [];
      for (const statement of statements) results.push(await statement._prepare().execute());
      return results;
    }) as never);
    restores.push(() => prepare.mockRestore(), () => batch.mockRestore());
    return { queries, batches };
  }

  test("submission preserves the raw microsecond token and accepts no-progress completeness", async () => {
    const { queries } = intercept();
    expect(await progressRouter.createCaller(ctx).transitionPeriod({ periodId: "period-1", to: "submitted" }))
      .toEqual({ status: "submitted" });
    expect(queries[0]!.sql).toContain('"reporting_period"."updated_at"::text');
    const mutation = queries.find((q) => q.sql.includes("with changed as"))!;
    expect(mutation.params).toContain(token);
    expect(mutation.sql).toMatch(/where id = \$\d+ and status = \$\d+\s+and updated_at = \$\d+::timestamp/);
    expect(mutation.sql).toContain("insert into reporting_period_event");
    expect(mutation.sql).toContain("from changed");
    expect(queries.some((q) => q.sql.startsWith('insert into "activity_log"'))).toBe(true);
  });

  test("a genuinely stale token differing by one microsecond still rejects without activity", async () => {
    const { queries } = intercept({ currentToken: "2026-09-09 12:34:56.123457" });
    await expect(progressRouter.createCaller(ctx).transitionPeriod({ periodId: "period-1", to: "submitted" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: t.progress.periodChangedRefresh });
    expect(queries.some((q) => q.sql.startsWith('insert into "activity_log"'))).toBe(false);
  });

  test("missing lines prevent submission before the optimistic write", async () => {
    const { queries } = intercept({ missing: true });
    await expect(progressRouter.createCaller(ctx).transitionPeriod({ periodId: "period-1", to: "submitted" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(queries.some((q) => q.sql.includes("with changed as"))).toBe(false);
  });

  for (const noProgress of [true, false]) {
    test(`markNoProgress ${noProgress} retains the project lock and reading protection`, async () => {
      const { queries, batches } = intercept();
      expect(await progressRouter.createCaller(ctx).markNoProgress({
        periodId: "period-1", boqItemIds: ["item-1"], noProgress,
      })).toEqual({ marked: 1 });
      expect(batches).toEqual([2]);
      const lockIndex = queries.findIndex((q) => q.sql.includes("pg_advisory_xact_lock"));
      expect(queries[lockIndex]!.params).toEqual(["project-1"]);
      const mutation = queries[lockIndex + 1]!;
      expect(mutation.sql).toContain("with input_rows");
      expect(JSON.parse(mutation.params[0] as string)[0]).toMatchObject({ boqItemId: "item-1", noProgress });
      expect(mutation.sql).toContain("status in ('open', 'draft', 'returned')");
      expect(mutation.sql).toContain("where excluded.no_progress = false");
      expect(mutation.sql).toContain("progress_entry.cumulative_percent is null");
      expect(mutation.sql).toContain("progress_entry.cumulative_quantity is null");
    });
  }

  test("markNoProgress rejects a period that became non-editable", async () => {
    intercept({ marked: null });
    await expect(progressRouter.createCaller(ctx).markNoProgress({ periodId: "period-1" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: t.progress.periodNotEditable });
  });

  test("markNoProgress returns zero without a write when no lines remain", async () => {
    const { queries, batches } = intercept({ empty: true });
    expect(await progressRouter.createCaller(ctx).markNoProgress({ periodId: "period-1" })).toEqual({ marked: 0 });
    expect(batches).toEqual([]);
    expect(queries.some((q) => q.sql.includes("with input_rows"))).toBe(false);
  });
});
