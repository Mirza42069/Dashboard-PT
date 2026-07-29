/**
 * Demo construction data, so the dashboard can be evaluated with real numbers
 * instead of a screen of zeroes.
 *
 * Run with: bun run db:seed-demo
 *
 * Idempotent, and narrowly so: it deletes exactly the codes listed below, in
 * the target company only, then recreates them. Anything you entered by hand
 * survives even if it sits in the same company — there is no prefix match and
 * no "delete everything here" step.
 *
 * The codes are deliberately ordinary (PRJ-001) rather than DEMO-prefixed:
 * this data is meant to read as a real portfolio in a live deployment. That
 * is also why the clear list has to be explicit — there is no longer a
 * marker distinguishing seeded rows from real ones.
 *
 * Everything lands in one company — SKN by default, so BKU stays a clean slate.
 * Override with `--company=<code>`.
 */
import { db } from "@DashboardV2/db";
import { company, project, ticket, user } from "@DashboardV2/db/schema";
import type { ProjectStatus } from "@DashboardV2/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const DEFAULT_COMPANY_CODE = "SKN";

/** Codes this script owns. Everything else in the company is left alone. */
const projectCode = (suffix: string) => `PRJ-${suffix}`;

function targetCompanyCode() {
  const flag = process.argv.find((arg) => arg.startsWith("--company="));
  return (flag ? flag.slice("--company=".length) : DEFAULT_COMPANY_CODE).toUpperCase();
}

function isoDate(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const PROJECT_SEEDS: {
  suffix: string;
  name: string;
  client: string;
  location: string;
  status: ProjectStatus;
  progress: number;
  start: number;
  end: number;
}[] = [
  { suffix: "001", name: "Riverside Tower — Phase 1", client: "Meridian Holdings", location: "Riverside", status: "active", progress: 62, start: -180, end: 120 },
  { suffix: "002", name: "Northgate Retail Park", client: "Northgate Estates", location: "Northgate", status: "active", progress: 41, start: -95, end: 160 },
  { suffix: "003", name: "Harbour Road Bridge Repair", client: "City Transport Authority", location: "Harbour Road", status: "active", progress: 78, start: -140, end: 25 },
  { suffix: "004", name: "Eastfield Warehouse", client: "Eastfield Logistics", location: "Eastfield", status: "on_hold", progress: 18, start: -60, end: 240 },
  { suffix: "005", name: "Civic Centre Refurbishment", client: "Borough Council", location: "Civic Square", status: "planning", progress: 0, start: 30, end: 420 },
  { suffix: "006", name: "Lakeside Apartments", client: "Lakeside Developments", location: "Lakeside", status: "completed", progress: 100, start: -520, end: -40 },
];

const TICKET_SEEDS = [
  ["Water ingress reported in basement", "Inspect the west wall and confirm the source of the leak."],
  ["Damaged access gate", "The main access gate does not close securely after delivery traffic."],
  ["Missing safety signage", "Replace the warning signs near the active work area."],
] as const;

async function clearDemoData(companyId: string) {
  // Exactly the codes this script generates, in this company only.
  const isSeededProject = and(
    eq(project.companyId, companyId),
    inArray(project.code, PROJECT_SEEDS.map((entry) => projectCode(entry.suffix))),
  );

  // Tickets cascade from project.
  const seededProjects = await db.select({ id: project.id }).from(project).where(isSeededProject);

  if (seededProjects.length > 0) {
    await db.delete(project).where(isSeededProject);
  }

  console.log(`Cleared ${seededProjects.length} previously seeded project(s)`);
}

async function main() {
  const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin"));
  if (!admin) {
    console.error("No admin account found. Run `bun run db:seed-admin` first.");
    process.exit(1);
  }

  const code = targetCompanyCode();
  const [target] = await db
    .select({ id: company.id, name: company.name })
    .from(company)
    .where(eq(company.code, code));
  if (!target) {
    console.error(`No company with code ${code}. Create it under Admin → Companies first.`);
    process.exit(1);
  }
  const companyId = target.id;
  console.log(`Seeding into ${target.name} (${code})`);

  await clearDemoData(companyId);

  // --- Projects -----------------------------------------------------------
  const projectRows = PROJECT_SEEDS.map((entry) => ({
    companyId,
    code: projectCode(entry.suffix),
    name: entry.name,
    client: entry.client,
    location: entry.location,
    status: entry.status,
    startDate: isoDate(entry.start),
    endDate: isoDate(entry.end),
    progress: entry.progress,
    managerId: admin.id,
  }));

  const projects = await db
    .insert(project)
    .values(projectRows)
    .returning({ id: project.id, code: project.code });
  console.log(`Inserted ${projects.length} projects`);

  // --- Tickets ------------------------------------------------------------
  const ticketRows = projects.map((row, projectIndex) => {
    const [title, description] = TICKET_SEEDS[projectIndex % TICKET_SEEDS.length]!;
    return {
      projectId: row.id,
      title,
      description,
      issuerId: admin.id,
      issuerName: "Demo administrator",
      responsibleName: "Demo administrator",
      responsibleContactNumber: "+62 812 0000 0000",
      status: (projectIndex % 3 === 0
        ? "open"
        : projectIndex % 3 === 1
          ? "in_progress"
          : "resolved") as "open" | "in_progress" | "resolved" | "closed",
    };
  });
  await db.insert(ticket).values(ticketRows);
  console.log(`Inserted ${ticketRows.length} tickets`);

  console.log("\nDemo data ready. Open http://localhost:3001/dashboard");
}

main().catch((error) => {
  console.error("Failed to seed demo data:", error instanceof Error ? error.message : error);
  process.exit(1);
});
