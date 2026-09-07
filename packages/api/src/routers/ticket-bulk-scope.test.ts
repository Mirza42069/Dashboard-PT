import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { NeonHttpSession } from "drizzle-orm/neon-http";
import type { Context } from "../context";
import { dictionaryFor } from "../lib/messages";

// Router imports require server env; SQL execution is intercepted, never sent to Neon.
describe.skipIf(!process.env.DATABASE_URL)("bulk ticket scope", () => {
  let ticketRouter: typeof import("./ticket").ticketRouter;
  let restore: (() => void) | undefined;
  const t = dictionaryFor("en");
  const ctx = (role = "user") => ({
    headers: new Headers(), locale: "en", t,
    session: { user: { id: "user-1", name: "Tester", role } },
    getCompanyId: async () => "company-1",
  }) as unknown as Context;
  const row = (id: string, projectId = id, archivedAt: Date | null = null) => ({
    ticket: { id, title: id, status: "open" },
    projectId, projectCode: projectId, projectName: projectId, archivedAt,
  });

  beforeAll(async () => { ({ ticketRouter } = await import("./ticket")); });
  afterEach(() => restore?.());

  function intercept(rows: ReturnType<typeof row>[]) {
    const queries: { sql: string; params: unknown[] }[] = [];
    const spy = spyOn(NeonHttpSession.prototype, "prepareQuery").mockImplementation((query) => ({
      setToken() { return this; },
      execute: async () => {
        queries.push(query);
        if (query.sql.startsWith("select") && query.sql.includes('from "ticket"')) return rows;
        if (query.sql.includes("with input_rows")) return { rows: rows.map(({ ticket }) => ({ id: ticket.id })) };
        return [];
      },
    }) as never);
    restore = () => spy.mockRestore();
    return queries;
  }

  for (const action of ["deleteMany", "setStatusMany"] as const) {
    const call = (caller: ReturnType<typeof ticketRouter.createCaller>, ids: string[]) =>
      action === "deleteMany" ? caller.deleteMany({ ids }) : caller.setStatusMany({ ids, status: "resolved" });

    test(`${action} authorizes thirty projects in one query and deduplicates tickets`, async () => {
      const rows = Array.from({ length: 30 }, (_, i) => row(`ticket-${i}`, `project-${i}`));
      const queries = intercept(rows);
      const ids = rows.map(({ ticket }) => ticket.id);
      expect(await call(ticketRouter.createCaller(ctx()), [...ids, ids[0]!]))
        .toEqual({ success: true, count: 30 });
      const reads = queries.filter(({ sql }) => sql.startsWith("select"));
      expect(reads).toHaveLength(1);
      expect(reads[0]!.sql).toContain('inner join "project" on "ticket"."project_id" = "project"."id"');
      expect(reads[0]!.sql).toContain('"project"."company_id" =');
      expect(reads[0]!.sql).toContain('exists (select 1 from "project_member"');
      expect(reads[0]!.sql).toContain('"project_member"."project_id" = "project"."id"');
      expect(reads[0]!.sql).toContain('"project_member"."user_id" =');
      expect(reads[0]!.params).toEqual([...ids, ids[0], "company-1", "user-1"]);
      expect(queries).toHaveLength(3); // Scope, mutation, one audit insert.
      const audit = queries[2]!;
      expect(audit.sql).toStartWith('insert into "activity_log"');
    });

    for (const role of ["admin", "super_admin"]) {
      test(`${action} keeps ${role} tenant-scoped without requiring membership`, async () => {
        const queries = intercept([row("a"), row("b")]);
        expect(await call(ticketRouter.createCaller(ctx(role)), ["a", "b"]))
          .toEqual({ success: true, count: 2 });
        expect(queries[0]!.sql).toContain('"project"."company_id" =');
        expect(queries[0]!.sql).not.toContain('"project_member"');
        expect(queries[0]!.params).toEqual(["a", "b", "company-1"]);
      });
    }

    for (const missing of ["foreign-tenant", "unassigned-project", "nonexistent"]) {
      test(`${action} refuses the entire selection when ${missing} is filtered out`, async () => {
        const queries = intercept([row("allowed")]);
        await expect(call(ticketRouter.createCaller(ctx()), ["allowed", "allowed", missing]))
          .rejects.toMatchObject({ code: "NOT_FOUND", message: t.ticket.someNotFound });
        expect(queries).toHaveLength(1);
      });
    }

    test(`${action} returns noneFound without writes when no tickets are accessible`, async () => {
      const queries = intercept([]);
      await expect(call(ticketRouter.createCaller(ctx()), ["missing"]))
        .rejects.toMatchObject({ code: "NOT_FOUND", message: t.ticket.noneFound });
      expect(queries).toHaveLength(1);
    });

    test(`${action} checks archived projects beyond the first row before any write`, async () => {
      const queries = intercept([row("live"), row("archived", "other-project", new Date(0))]);
      await expect(call(ticketRouter.createCaller(ctx()), ["live", "archived"]))
        .rejects.toMatchObject({ code: "CONFLICT", message: t.archived.project });
      expect(queries).toHaveLength(1);
      expect(queries[0]!.sql).not.toContain('"project"."archived_at" is null');
    });
  }

  test("unchanged statuses still authorize every ticket but do not write", async () => {
    const queries = intercept([row("a"), row("b")]);
    expect(await ticketRouter.createCaller(ctx()).setStatusMany({ ids: ["a", "b", "a"], status: "open" }))
      .toEqual({ success: true, count: 0 });
    expect(queries).toHaveLength(1);
  });
});
