import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { company } from "@DashboardV2/db/schema/company";
import { project } from "@DashboardV2/db/schema/construction";
import { Effect } from "effect";
import { asc, count, eq } from "drizzle-orm";
import z from "zod";

import { permissionProcedure, protectedProcedure, router } from "../index";
import { attempt, fail, runProcedure } from "../lib/effect";
import { interpolate } from "../lib/messages/index";
import { roleOf } from "../lib/permissions";
import { resolveCompanyIdForSession } from "../lib/scope";

const upsertSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  code: z
    .string()
    .trim()
    .min(1, "Code is required")
    .max(16)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only"),
});

export const companyRouter = router({
  /**
   * Every signed-in user needs this to render the header: a regular user to
   * show which company they are in, an admin to populate the switcher. Regular
   * users only ever see their own — the list is not a directory of tenants.
   */
  options: protectedProcedure.query(({ ctx }) =>
    runProcedure(
      Effect.gen(function* () {
        const canSwitch = roleOf(ctx.session.user) === "super_admin";
        const rows = yield* attempt(() =>
          db
            .select({ id: company.id, name: company.name, code: company.code })
            .from(company)
            .orderBy(asc(company.createdAt)),
        );

        const activeId = yield* attempt(() =>
          resolveCompanyIdForSession(ctx.session.user, ctx.headers),
        );
        return {
          companies: canSwitch ? rows : rows.filter((row) => row.id === activeId),
          activeId,
          canSwitch,
        };
      }),
    ),
  ),

  list: permissionProcedure("company:manage").query(() =>
    runProcedure(
      Effect.gen(function* () {
        const rows = yield* attempt(() =>
          db
            .select({
              id: company.id,
              name: company.name,
              code: company.code,
              createdAt: company.createdAt,
            })
            .from(company)
            .orderBy(asc(company.createdAt)),
        );

        // Counts drive the "can this be deleted?" affordance in the table.
        const [projects, users] = yield* Effect.all([
          attempt(() =>
            db.select({ companyId: project.companyId, value: count() }).from(project).groupBy(project.companyId),
          ),
          attempt(() =>
            db.select({ companyId: user.companyId, value: count() }).from(user).groupBy(user.companyId),
          ),
        ], { concurrency: "unbounded" });

        const tally = (rows: { companyId: string | null; value: number }[], id: string) =>
          rows.find((row) => row.companyId === id)?.value ?? 0;

        return {
          companies: rows.map((row) => ({
            ...row,
            projects: tally(projects, row.id),
            users: tally(users, row.id),
          })),
        };
      }),
    ),
  ),

  create: permissionProcedure("company:manage")
    .input(upsertSchema)
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const code = input.code.toUpperCase();
          const [existing] = yield* attempt(() =>
            db.select({ id: company.id }).from(company).where(eq(company.code, code)),
          );
          if (existing) {
            return yield* fail("CONFLICT", interpolate(ctx.t.company.codeInUse, { code }));
          }

          const [created] = yield* attempt(() =>
            db
              .insert(company)
              .values({ name: input.name, code })
              .returning({ id: company.id }),
          );

          return { id: created?.id };
        }),
      ),
    ),

  update: permissionProcedure("company:manage")
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const { id, name, code } = input;
          const [current] = yield* attempt(() => db.select().from(company).where(eq(company.id, id)));
          if (!current) {
            return yield* fail("NOT_FOUND", ctx.t.company.notFound);
          }

          if (code && code.toUpperCase() !== current.code) {
            const [clash] = yield* attempt(() =>
              db
                .select({ id: company.id })
                .from(company)
                .where(eq(company.code, code.toUpperCase())),
            );
            if (clash) {
              return yield* fail("CONFLICT", interpolate(ctx.t.company.codeInUse, { code }));
            }
          }

          yield* attempt(() =>
            db
              .update(company)
              .set({ ...(name ? { name } : {}), ...(code ? { code: code.toUpperCase() } : {}) })
              .where(eq(company.id, id)),
          );

          return { success: true };
        }),
      ),
    ),

  /**
   * Refused while anything still belongs to the company. The restrict FKs
   * enforce this at the database too; checking here is what turns a constraint
   * violation into a sentence the admin can act on.
   */
  delete: permissionProcedure("company:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      runProcedure(
        Effect.gen(function* () {
          const [current] = yield* attempt(() =>
            db
              .select({ id: company.id })
              .from(company)
              .where(eq(company.id, input.id)),
          );
          if (!current) {
            return yield* fail("NOT_FOUND", ctx.t.company.notFound);
          }

          const [[projects], [users]] = yield* Effect.all([
            attempt(() => db.select({ value: count() }).from(project).where(eq(project.companyId, input.id))),
            attempt(() => db.select({ value: count() }).from(user).where(eq(user.companyId, input.id))),
          ], { concurrency: "unbounded" });

          const owned = (projects?.value ?? 0) + (users?.value ?? 0);
          if (owned > 0) {
            return yield* fail(
              "BAD_REQUEST",
              `This company still owns ${projects?.value ?? 0} project(s) ` +
                `and ${users?.value ?? 0} user(s). Move or delete them first.`,
            );
          }

          // Last company standing: deleting it would leave every request unable to
          // resolve a scope, locking the whole dashboard.
          const [{ value: total } = { value: 0 }] = yield* attempt(() =>
            db.select({ value: count() }).from(company),
          );
          if (total <= 1) {
            return yield* fail("BAD_REQUEST", ctx.t.company.cannotDeleteLast);
          }

          yield* attempt(() => db.delete(company).where(eq(company.id, input.id)));
          return { success: true };
        }),
      ),
    ),
});
