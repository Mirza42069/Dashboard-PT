import { roleOf } from "@DashboardV2/api/lib/permissions";
import { boqMetricsByProject } from "@DashboardV2/api/lib/boq-metrics";
import { projectAccessFilter } from "@DashboardV2/api/lib/scope";
import { db } from "@DashboardV2/db";
import { project, ticket, user } from "@DashboardV2/db/schema";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
// Type-only at the top level. exceljs is CommonJS and pulls in a large tree of
// dynamic requires, which Vercel's bundler does not resolve the same way Bun
// does locally — a static import here fails to resolve *at boot*, and because
// apps/server/src/index.ts imports this module eagerly it took the whole Hono
// app down with it: every route, including /api/auth/sign-in/email, answered
// 500 while the app worked perfectly in local dev. Loaded on demand instead, so
// the spreadsheet export can never again cost anyone the ability to sign in.
import type ExcelJS from "exceljs";

import {
  DATE_FORMAT,
  type Locale,
  MONEY_FORMAT,
  PERCENT_FORMAT,
  PROJECT_STATUS_LABELS,
  toExcelDate,
  todayStamp,
} from "./export-format";

/**
 * Builds the .xlsx behind the projects table's download button.
 *
 * Values are written as numbers and dates, not strings — the whole point of
 * handing someone a spreadsheet instead of a PDF is that they can sort, filter
 * and total it, and a column of `"Rp1.250.000"` text can do none of those. So
 * money carries a currency number format, percentages are real Excel
 * percentages, and calendar days are real dates.
 */

/**
 * Headers are duplicated here rather than read from the web app's dictionary.
 * `apps/web/src/i18n` is not a dependency of this app and cannot become one
 * without moving the dictionary into a shared package — a bigger change than an
 * export button justifies. Fifteen strings, and this file is the only thing
 * that would drift.
 */
const HEADERS = {
  en: [
    "Code",
    "Project",
    "Status",
    "Client",
    "Location",
    "Project manager",
    "Start date",
    "Target completion",
    "Site progress",
    "Contract value",
    "Value of work completed",
    "Remaining contract value",
    "Deviation",
    "Open tickets",
    "Notes",
  ],
  id: [
    "Kode",
    "Proyek",
    "Status",
    "Klien",
    "Lokasi",
    "Manajer proyek",
    "Tanggal mulai",
    "Target selesai",
    "Progres lokasi",
    "Nilai kontrak",
    "Nilai pekerjaan terlaksana",
    "Sisa nilai kontrak",
    "Deviasi",
    "Tindakan terbuka",
    "Catatan",
  ],
} as const;

const STATUS_LABELS = PROJECT_STATUS_LABELS;

const SHEET_NAME = { en: "Projects", id: "Proyek" } as const;

const COLUMN_WIDTHS = [12, 34, 13, 22, 20, 22, 13, 17, 13, 16, 22, 22, 11, 12, 40];

export async function buildProjectWorkbook({
  companyId,
  session,
  locale,
}: {
  companyId: string;
  session: { user: { id: string; role?: string | null } };
  locale: Locale;
}) {
  const rows = await db
    .select({
      p: project,
      managerName: user.name,
      managerRole: user.role,
    })
    .from(project)
    .leftJoin(user, eq(user.id, project.managerId))
    .where(projectAccessFilter({ companyId, session }))
    .orderBy(asc(project.code));

  const ids = rows.map((row) => row.p.id);
  const [metrics, openTickets] = await Promise.all([
    boqMetricsByProject(ids),
    openTicketsByProject(ids),
  ]);

  const { default: excel } = (await import("exceljs")) as unknown as { default: typeof ExcelJS };
  const workbook = new excel.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(SHEET_NAME[locale], {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.addRow([...HEADERS[locale]]);
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };

  COLUMN_WIDTHS.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  for (const { p, managerName, managerRole } of rows) {
    const boq = metrics.get(p.id);
    const contractValue = boq?.contractValue ?? null;
    const workCompleted = boq?.workCompletedValue ?? null;

    sheet.addRow([
      p.code,
      p.name,
      STATUS_LABELS[locale][p.status] ?? p.status,
      p.client ?? "",
      p.location ?? "",
      // A super admin is never shown by name. They cannot be assigned as a
      // manager any more, but a legacy row must not leak through the export
      // either — that is exactly where a leak would go unnoticed.
      managerName && roleOf({ role: managerRole }) !== "super_admin" ? managerName : "",
      toExcelDate(p.startDate),
      toExcelDate(p.endDate),
      // Real Excel percentages, so the cell reads 42.0% and still averages.
      (boq ? boq.progress : p.progress) / 100,
      contractValue,
      workCompleted,
      contractValue === null || workCompleted === null ? null : contractValue - workCompleted,
      boq?.deviation == null ? null : boq.deviation / 100,
      openTickets.get(p.id) ?? 0,
      p.notes ?? "",
    ]);
  }

  // Applied to the columns rather than cell by cell — one statement per format
  // instead of one per cell, and new rows inherit it.
  sheet.getColumn(7).numFmt = DATE_FORMAT;
  sheet.getColumn(8).numFmt = DATE_FORMAT;
  sheet.getColumn(9).numFmt = PERCENT_FORMAT;
  for (const index of [10, 11, 12]) sheet.getColumn(index).numFmt = MONEY_FORMAT;
  sheet.getColumn(13).numFmt = PERCENT_FORMAT;

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: HEADERS[locale].length },
  };

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    filename: `projects-${todayStamp()}.xlsx`,
    body: new Uint8Array(buffer as ArrayBuffer),
  };
}

/** Same rule the projects table counts by: open until explicitly closed. */
async function openTicketsByProject(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, number>();

  const rows = await db
    .select({ projectId: ticket.projectId, open: count() })
    .from(ticket)
    .where(and(inArray(ticket.projectId, projectIds), sql`${ticket.status} <> 'closed'`))
    .groupBy(ticket.projectId);

  return new Map(rows.map((row) => [row.projectId, row.open]));
}
