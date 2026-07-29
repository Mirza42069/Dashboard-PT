import { db } from "@DashboardV2/db";
import { user } from "@DashboardV2/db/schema/auth";
import { company } from "@DashboardV2/db/schema/company";
import { project } from "@DashboardV2/db/schema/construction";
import { TRPCError } from "@trpc/server";
import { asc, count, eq } from "drizzle-orm";
import z from "zod";

import { permissionProcedure, protectedProcedure, router } from "../index";
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
  options: protectedProcedure.query(async ({ ctx }) => {
    const canSwitch = roleOf(ctx.session.user) === "super_admin";
    const rows = await db
      .select({ id: company.id, name: company.name, code: company.code })
      .from(company)
      .orderBy(asc(company.createdAt));

    const activeId = await resolveCompanyIdForSession(ctx.session.user, ctx.headers);
    return {
      companies: canSwitch ? rows : rows.filter((row) => row.id === activeId),
      activeId,
      canSwitch,
    };
  }),

  list: permissionProcedure("company:manage").query(async () => {
    const rows = await db
      .select({
        id: company.id,
        name: company.name,
        code: company.code,
        createdAt: company.createdAt,
      })
      .from(company)
      .orderBy(asc(company.createdAt));

    // Counts drive the "can this be deleted?" affordance in the table.
    const [projects, users] = await Promise.all([
      db.select({ companyId: project.companyId, value: count() }).from(project).groupBy(project.companyId),
      db.select({ companyId: user.companyId, value: count() }).from(user).groupBy(user.companyId),
    ]);

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

  create: permissionProcedure("company:manage").input(upsertSchema).mutation(async ({ input }) => {
    const code = input.code.toUpperCase();
    const [existing] = await db.select({ id: company.id }).from(company).where(eq(company.code, code));
    if (existing) {
      throw new TRPCError({ code: "CONFLICT", message: `Company code ${code} is already in use` });
    }

    const [created] = await db
      .insert(company)
      .values({ name: input.name, code })
      .returning({ id: company.id });

    return { id: created?.id };
  }),

  update: permissionProcedure("company:manage")
    .input(upsertSchema.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { id, name, code } = input;
      const [current] = await db.select().from(company).where(eq(company.id, id));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      if (code && code.toUpperCase() !== current.code) {
        const [clash] = await db
          .select({ id: company.id })
          .from(company)
          .where(eq(company.code, code.toUpperCase()));
        if (clash) {
          throw new TRPCError({ code: "CONFLICT", message: `Company code ${code} is already in use` });
        }
      }

      await db
        .update(company)
        .set({ ...(name ? { name } : {}), ...(code ? { code: code.toUpperCase() } : {}) })
        .where(eq(company.id, id));

      return { success: true };
    }),

  /**
   * Refused while anything still belongs to the company. The restrict FKs
   * enforce this at the database too; checking here is what turns a constraint
   * violation into a sentence the admin can act on.
   */
  delete: permissionProcedure("company:manage")
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const [current] = await db
        .select({ id: company.id })
        .from(company)
        .where(eq(company.id, input.id));
      if (!current) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      const [[projects], [users]] = await Promise.all([
        db.select({ value: count() }).from(project).where(eq(project.companyId, input.id)),
        db.select({ value: count() }).from(user).where(eq(user.companyId, input.id)),
      ]);

      const owned = (projects?.value ?? 0) + (users?.value ?? 0);
      if (owned > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            `This company still owns ${projects?.value ?? 0} project(s) ` +
            `and ${users?.value ?? 0} user(s). Move or delete them first.`,
        });
      }

      // Last company standing: deleting it would leave every request unable to
      // resolve a scope, locking the whole dashboard.
      const [{ value: total } = { value: 0 }] = await db.select({ value: count() }).from(company);
      if (total <= 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete the only remaining company",
        });
      }

      await db.delete(company).where(eq(company.id, input.id));
      return { success: true };
    }),
});
