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
 * The codes are deliberately ordinary (PRJ-001, CEM, EQ-EXC1) rather than
 * DEMO-prefixed: this data is meant to read as a real portfolio in a live
 * deployment. That is also why the clear list has to be explicit — there is no
 * longer a marker distinguishing seeded rows from real ones.
 *
 * Everything lands in one company — SKN by default, so BKU stays a clean slate.
 * Override with `--company=<code>`.
 */
import { db } from "@DashboardV2/db";
import {
  company,
  equipment,
  expense,
  material,
  materialMovement,
  project,
  task,
  user,
} from "@DashboardV2/db/schema";
import type { ExpenseCategory, ProjectStatus, TaskStatus } from "@DashboardV2/db/schema";
import { and, eq, inArray } from "drizzle-orm";

const DEFAULT_COMPANY_CODE = "SKN";

/** Codes this script owns. Everything else in the company is left alone. */
const projectCode = (suffix: string) => `PRJ-${suffix}`;
const materialSku = (suffix: string) => suffix;
const equipmentCode = (suffix: string) => `EQ-${suffix}`;

function targetCompanyCode() {
  const flag = process.argv.find((arg) => arg.startsWith("--company="));
  return (flag ? flag.slice("--company=".length) : DEFAULT_COMPANY_CODE).toUpperCase();
}

/** Deterministic pseudo-random so re-runs produce comparable numbers. */
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)] as T;
}
function between(min: number, max: number) {
  return Math.round(min + rand() * (max - min));
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

const TASK_TITLES = [
  "Site survey and setup", "Excavation and groundworks", "Foundation pour", "Steel frame erection",
  "First-floor slab", "Roof structure", "External cladding", "Window installation",
  "First-fix electrical", "First-fix plumbing", "Internal partitions", "Plastering",
  "Second-fix electrical", "Flooring", "External drainage", "Landscaping",
  "Fire safety inspection", "Snagging and handover",
];

const MATERIAL_SEEDS = [
  { suffix: "CEM", name: "Portland Cement 42.5N", unit: "bag", reorder: 200, cost: 9.5, opening: 640 },
  { suffix: "SND", name: "Sharp Sand", unit: "m3", reorder: 40, cost: 32, opening: 120 },
  { suffix: "AGG", name: "20mm Aggregate", unit: "m3", reorder: 40, cost: 38, opening: 95 },
  { suffix: "RBR", name: "Rebar 12mm", unit: "ton", reorder: 5, cost: 780, opening: 18 },
  { suffix: "BLK", name: "Concrete Block 100mm", unit: "piece", reorder: 1500, cost: 1.4, opening: 5200 },
  { suffix: "TMB", name: "Structural Timber C24", unit: "m3", reorder: 12, cost: 420, opening: 34 },
  { suffix: "PLY", name: "Plywood Sheet 18mm", unit: "sheet", reorder: 100, cost: 28, opening: 260 },
  { suffix: "INS", name: "Insulation Batt 100mm", unit: "roll", reorder: 60, cost: 24, opening: 40 },
  { suffix: "PLB", name: "Plasterboard 12.5mm", unit: "sheet", reorder: 200, cost: 11, opening: 150 },
  { suffix: "PNT", name: "Emulsion Paint 10L", unit: "tub", reorder: 25, cost: 46, opening: 88 },
  { suffix: "PIP", name: "PVC Pipe 110mm", unit: "length", reorder: 80, cost: 17, opening: 210 },
  { suffix: "CBL", name: "Twin & Earth Cable 2.5mm", unit: "roll", reorder: 30, cost: 92, opening: 74 },
  { suffix: "TIL", name: "Roof Tile Concrete", unit: "piece", reorder: 2000, cost: 1.1, opening: 6400 },
  { suffix: "SCF", name: "Scaffold Tube 3m", unit: "piece", reorder: 150, cost: 14, opening: 430 },
  { suffix: "MRT", name: "Mortar Mix", unit: "bag", reorder: 150, cost: 7.2, opening: 380 },
];

const EQUIPMENT_SEEDS = [
  { suffix: "EXC1", name: "CAT 320 Excavator", category: "Excavator" },
  { suffix: "EXC2", name: "JCB 3CX Backhoe", category: "Excavator" },
  { suffix: "CRN1", name: "Potain MDT 219 Tower Crane", category: "Crane" },
  { suffix: "CRN2", name: "Grove RT540E Mobile Crane", category: "Crane" },
  { suffix: "MIX1", name: "Concrete Mixer 350L", category: "Concrete" },
  { suffix: "MIX2", name: "Concrete Pump Truck", category: "Concrete" },
  { suffix: "GEN1", name: "Generator 100kVA", category: "Power" },
  { suffix: "GEN2", name: "Generator 40kVA", category: "Power" },
  { suffix: "SCS1", name: "Scissor Lift 12m", category: "Access" },
  { suffix: "DMP1", name: "Site Dumper 9T", category: "Haulage" },
];

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "labor",
  "materials",
  "equipment",
  "subcontractor",
  "other",
];

const EXPENSE_NOTES: Record<ExpenseCategory, string[]> = {
  labor: ["Weekly site labour", "Overtime — concrete pour", "Site supervision"],
  materials: ["Cement delivery", "Rebar order", "Blockwork delivery"],
  equipment: ["Crane hire", "Excavator fuel", "Plant maintenance"],
  subcontractor: ["Electrical first fix", "Roofing contractor", "Groundworks subcontract"],
  other: ["Site welfare units", "Waste removal", "Permits and fees"],
};

async function clearDemoData(companyId: string) {
  // Exactly the codes this script generates, in this company only.
  const isSeededProject = and(
    eq(project.companyId, companyId),
    inArray(project.code, PROJECT_SEEDS.map((entry) => projectCode(entry.suffix))),
  );
  const isSeededMaterial = and(
    eq(material.companyId, companyId),
    inArray(material.sku, MATERIAL_SEEDS.map((entry) => materialSku(entry.suffix))),
  );

  // Tasks and expenses cascade from project; equipment/materials are separate.
  const seededProjects = await db.select({ id: project.id }).from(project).where(isSeededProject);

  if (seededProjects.length > 0) {
    await db.delete(project).where(isSeededProject);
  }
  // Only movements belonging to the seeded materials — a blanket delete would
  // wipe hand-entered history too.
  const seededMaterials = await db
    .select({ id: material.id })
    .from(material)
    .where(isSeededMaterial);
  if (seededMaterials.length > 0) {
    await db.delete(materialMovement).where(
      inArray(
        materialMovement.materialId,
        seededMaterials.map((row) => row.id),
      ),
    );
  }
  await db.delete(material).where(isSeededMaterial);
  await db.delete(equipment).where(
    and(
      eq(equipment.companyId, companyId),
      inArray(equipment.code, EQUIPMENT_SEEDS.map((entry) => equipmentCode(entry.suffix))),
    ),
  );

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

  // --- Tasks --------------------------------------------------------------
  const taskRows = projects.flatMap((row) => {
    const count = between(5, 9);
    return Array.from({ length: count }, (_, index) => {
      const status: TaskStatus =
        index < count * 0.4 ? "done" : index < count * 0.7 ? "in_progress" : pick(["todo", "blocked"]);
      return {
        projectId: row.id,
        title: TASK_TITLES[(index * 3 + projects.indexOf(row)) % TASK_TITLES.length] as string,
        status,
        priority: pick(["low", "medium", "high"] as const),
        assigneeId: admin.id,
        dueDate: isoDate(between(-40, 90)),
        isMilestone: index % 4 === 0,
      };
    });
  });
  await db.insert(task).values(taskRows);
  console.log(`Inserted ${taskRows.length} tasks`);

  // --- Expenses -----------------------------------------------------------
  const expenseRows = projects.flatMap((row) => {
    const count = between(6, 11);
    const each = between(40_000, 180_000);

    return Array.from({ length: count }, () => {
      const category = pick(EXPENSE_CATEGORIES);
      return {
        projectId: row.id,
        category,
        description: pick(EXPENSE_NOTES[category]),
        amount: (each * (0.7 + rand() * 0.6)).toFixed(2),
        incurredOn: isoDate(-between(1, 150)),
        recordedById: admin.id,
      };
    });
  });
  await db.insert(expense).values(expenseRows);
  console.log(`Inserted ${expenseRows.length} expenses`);

  // --- Materials + movements ----------------------------------------------
  const materials = await db
    .insert(material)
    .values(
      MATERIAL_SEEDS.map((entry) => ({
        companyId,
        sku: materialSku(entry.suffix),
        name: entry.name,
        unit: entry.unit,
        reorderLevel: entry.reorder.toFixed(2),
        unitCost: entry.cost.toFixed(2),
      })),
    )
    .returning({ id: material.id, sku: material.sku });
  console.log(`Inserted ${materials.length} materials`);

  const activeProjects = projects.filter((row) => !row.code.endsWith("005"));
  const movementRows = materials.flatMap((row, index) => {
    const config = MATERIAL_SEEDS[index];
    if (!config) return [];

    // Opening delivery, then issues to sites. INS and PLB are issued heavily so
    // they land below their reorder level and drive the low-stock tiles.
    const heavyUse = config.suffix === "INS" || config.suffix === "PLB";
    const issueTotal = heavyUse ? config.opening * 0.85 : config.opening * between(20, 45) / 100;
    const issueCount = between(2, 4);

    return [
      {
        materialId: row.id,
        projectId: null,
        type: "in" as const,
        quantity: config.opening.toFixed(2),
        occurredOn: isoDate(-between(120, 200)),
        note: "Opening stock",
        recordedById: admin.id,
      },
      ...Array.from({ length: issueCount }, () => ({
        materialId: row.id,
        projectId: pick(activeProjects).id,
        type: "out" as const,
        quantity: (issueTotal / issueCount).toFixed(2),
        occurredOn: isoDate(-between(1, 100)),
        note: "Issued to site",
        recordedById: admin.id,
      })),
    ];
  });
  await db.insert(materialMovement).values(movementRows);
  console.log(`Inserted ${movementRows.length} material movements`);

  // --- Equipment ----------------------------------------------------------
  const equipmentRows = EQUIPMENT_SEEDS.map((entry, index) => {
    const deployed = index < 6;
    return {
      companyId,
      code: equipmentCode(entry.suffix),
      name: entry.name,
      category: entry.category,
      status: deployed ? ("in_use" as const) : index < 8 ? ("available" as const) : ("maintenance" as const),
      projectId: deployed ? pick(activeProjects).id : null,
      purchaseDate: isoDate(-between(400, 2000)),
    };
  });
  await db.insert(equipment).values(equipmentRows);
  console.log(`Inserted ${equipmentRows.length} equipment items`);

  console.log("\nDemo data ready. Open http://localhost:3001/dashboard");
}

main().catch((error) => {
  console.error("Failed to seed demo data:", error instanceof Error ? error.message : error);
  process.exit(1);
});
