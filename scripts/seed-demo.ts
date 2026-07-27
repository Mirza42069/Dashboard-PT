/**
 * Demo construction data, so the dashboard can be evaluated with real numbers
 * instead of a screen of zeroes.
 *
 * Run with: bun run db:seed-demo
 *
 * Idempotent: every row it creates carries a DEMO- prefixed code, and those are
 * deleted first. Anything you created by hand is left alone.
 */
import { db } from "@DashboardV2/db";
import {
  equipment,
  expense,
  material,
  materialMovement,
  project,
  task,
  user,
} from "@DashboardV2/db/schema";
import type { ExpenseCategory, ProjectStatus, TaskStatus } from "@DashboardV2/db/schema";
import { eq, inArray, like } from "drizzle-orm";

const PREFIX = "DEMO-";

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
  contract: number;
  budget: number;
  progress: number;
  start: number;
  end: number;
}[] = [
  { suffix: "001", name: "Riverside Tower — Phase 1", client: "Meridian Holdings", location: "Riverside", status: "active", contract: 4_800_000, budget: 4_100_000, progress: 62, start: -180, end: 120 },
  { suffix: "002", name: "Northgate Retail Park", client: "Northgate Estates", location: "Northgate", status: "active", contract: 2_350_000, budget: 1_980_000, progress: 41, start: -95, end: 160 },
  { suffix: "003", name: "Harbour Road Bridge Repair", client: "City Transport Authority", location: "Harbour Road", status: "active", contract: 890_000, budget: 720_000, progress: 78, start: -140, end: 25 },
  { suffix: "004", name: "Eastfield Warehouse", client: "Eastfield Logistics", location: "Eastfield", status: "on_hold", contract: 1_650_000, budget: 1_400_000, progress: 18, start: -60, end: 240 },
  { suffix: "005", name: "Civic Centre Refurbishment", client: "Borough Council", location: "Civic Square", status: "planning", contract: 3_200_000, budget: 2_750_000, progress: 0, start: 30, end: 420 },
  { suffix: "006", name: "Lakeside Apartments", client: "Lakeside Developments", location: "Lakeside", status: "completed", contract: 5_400_000, budget: 4_900_000, progress: 100, start: -520, end: -40 },
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

async function clearDemoData() {
  // Tasks and expenses cascade from project; equipment/materials are separate.
  const demoProjects = await db
    .select({ id: project.id })
    .from(project)
    .where(like(project.code, `${PREFIX}%`));

  if (demoProjects.length > 0) {
    await db.delete(project).where(like(project.code, `${PREFIX}%`));
  }
  // Only movements belonging to demo materials — a blanket delete would wipe
  // hand-entered history too.
  const demoMaterials = await db
    .select({ id: material.id })
    .from(material)
    .where(like(material.sku, `${PREFIX}%`));
  if (demoMaterials.length > 0) {
    await db.delete(materialMovement).where(
      inArray(
        materialMovement.materialId,
        demoMaterials.map((row) => row.id),
      ),
    );
  }
  await db.delete(material).where(like(material.sku, `${PREFIX}%`));
  await db.delete(equipment).where(like(equipment.code, `${PREFIX}%`));

  console.log(`Cleared ${demoProjects.length} existing demo project(s)`);
}

async function main() {
  const [admin] = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin"));
  if (!admin) {
    console.error("No admin account found. Run `bun run db:seed-admin` first.");
    process.exit(1);
  }

  await clearDemoData();

  // --- Projects -----------------------------------------------------------
  const projectRows = PROJECT_SEEDS.map((entry) => ({
    code: `${PREFIX}${entry.suffix}`,
    name: entry.name,
    client: entry.client,
    location: entry.location,
    status: entry.status,
    startDate: isoDate(entry.start),
    endDate: isoDate(entry.end),
    contractValue: entry.contract.toFixed(2),
    budget: entry.budget.toFixed(2),
    progress: entry.progress,
    managerId: admin.id,
  }));

  const projects = await db
    .insert(project)
    .values(projectRows)
    .returning({ id: project.id, code: project.code, budget: project.budget });
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
  // Riverside (001) is deliberately pushed over budget so the over-budget
  // state and the dashboard attention list have something to show.
  const expenseRows = projects.flatMap((row) => {
    const budget = Number(row.budget);
    const targetRatio = row.code.endsWith("001") ? 1.08 : row.code.endsWith("003") ? 0.86 : 0.45;
    const target = budget * targetRatio;
    const count = between(6, 11);
    const each = target / count;

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
        sku: `${PREFIX}${entry.suffix}`,
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
      code: `${PREFIX}${entry.suffix}`,
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
