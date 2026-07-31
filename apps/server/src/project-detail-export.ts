import { boqMetricsByProject } from "@DashboardV2/api/lib/boq-metrics";
import {
  computeActualCurve,
  computePlannedCurve,
  distributionMap,
  scheduleRows,
} from "@DashboardV2/api/lib/curves";
import { toAmount } from "@DashboardV2/api/lib/money";
import { roleOf } from "@DashboardV2/api/lib/permissions";
import { db } from "@DashboardV2/db";
import {
  boqItem,
  boqItemDistribution,
  boqVersion,
  progressEntry,
  project,
  projectMember,
  reportingPeriod,
  ticket,
  user,
} from "@DashboardV2/db/schema";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
// Type-only, for the same reason project-export.ts does it: exceljs is CommonJS
// over a tree of dynamic requires that Vercel's bundler will not resolve at
// boot. See the comment on the lazy import inside buildProjectDetailWorkbook.
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
 * One project as a workbook: the summary tiles, the bill of quantities, the
 * plan and actual matrices behind the progress tab, the S-curve those two
 * produce, the tickets, and the team.
 *
 * The portfolio export next door answers "how are all our projects doing"; this
 * one answers "show me everything about this one", which is the file people
 * attach to a progress report. Same rules apply — numbers stay numbers, dates
 * stay dates — because the point of a spreadsheet over a PDF is that the
 * recipient can pivot and total it.
 *
 * Headers live here rather than in the web app's dictionary for the reason
 * given in project-export.ts: apps/web/src/i18n is not a dependency of this app.
 * The *maths*, on the other hand, is shared — computePlannedCurve and
 * computeActualCurve come from packages/api so the S-curve sheet cannot drift
 * from the chart it mirrors.
 */

const SHEETS = {
  en: {
    summary: "Summary",
    boq: "BoQ",
    plan: "Plan",
    progress: "Progress",
    curve: "S-curve",
    tickets: "Tickets",
    team: "Team",
  },
  id: {
    summary: "Ringkasan",
    boq: "RAB",
    plan: "Rencana",
    progress: "Realisasi",
    curve: "Kurva-S",
    tickets: "Tiket",
    team: "Tim",
  },
} as const;

const LABELS = {
  en: {
    code: "Code",
    project: "Project",
    status: "Status",
    client: "Client",
    location: "Location",
    manager: "Project manager",
    startDate: "Start date",
    targetCompletion: "Target completion",
    periodType: "Reporting cadence",
    dataDate: "Data date",
    contractValue: "Contract value",
    workCompleted: "Value of work completed",
    remaining: "Remaining contract value",
    siteProgress: "Site progress",
    planned: "Planned progress",
    deviation: "Deviation",
    openTickets: "Open tickets",
    notes: "Notes",
    field: "Field",
    value: "Value",

    section: "Section",
    description: "Description",
    unit: "Unit",
    quantity: "Quantity",
    unitRate: "Unit rate",
    lineValue: "Value",
    weight: "Weight",
    progressMode: "Measured by",
    byQuantity: "Quantity",
    byPercent: "Percent",

    period: "Period",
    periodStart: "Period start",
    periodEnd: "Period end",
    plannedCumulative: "Planned cumulative",
    actualCumulative: "Actual cumulative",

    title: "Title",
    issuer: "Raised by",
    responsible: "Responsible",
    contact: "Contact",
    created: "Created",
    updated: "Updated",

    name: "Name",
    email: "Email",
    role: "Role",
    addedOn: "Added on",

    noBaseline: "No active baseline — this project has no bill of quantities yet.",
  },
  id: {
    code: "Kode",
    project: "Proyek",
    status: "Status",
    client: "Klien",
    location: "Lokasi",
    manager: "Manajer proyek",
    startDate: "Tanggal mulai",
    targetCompletion: "Target selesai",
    periodType: "Periode pelaporan",
    dataDate: "Tanggal data",
    contractValue: "Nilai kontrak",
    workCompleted: "Nilai pekerjaan terlaksana",
    remaining: "Sisa nilai kontrak",
    siteProgress: "Kemajuan lokasi",
    planned: "Rencana kemajuan",
    deviation: "Deviasi",
    openTickets: "Tiket terbuka",
    notes: "Catatan",
    field: "Keterangan",
    value: "Nilai",

    section: "Bagian",
    description: "Uraian",
    unit: "Satuan",
    quantity: "Volume",
    unitRate: "Harga satuan",
    lineValue: "Jumlah",
    weight: "Bobot",
    progressMode: "Diukur dengan",
    byQuantity: "Volume",
    byPercent: "Persen",

    period: "Periode",
    periodStart: "Mulai periode",
    periodEnd: "Akhir periode",
    plannedCumulative: "Rencana kumulatif",
    actualCumulative: "Realisasi kumulatif",

    title: "Judul",
    issuer: "Dilaporkan oleh",
    responsible: "Penanggung jawab",
    contact: "Kontak",
    created: "Dibuat",
    updated: "Diperbarui",

    name: "Nama",
    email: "Email",
    role: "Peran",
    addedOn: "Ditambahkan",

    noBaseline: "Belum ada baseline aktif — proyek ini belum memiliki RAB.",
  },
} as const;

const TICKET_STATUS_LABELS = {
  en: { open: "Open", in_progress: "In progress", resolved: "Resolved", closed: "Closed" },
  id: { open: "Terbuka", in_progress: "Dikerjakan", resolved: "Selesai", closed: "Ditutup" },
} as const;

const PERIOD_TYPE_LABELS = {
  en: { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" },
  id: { weekly: "Mingguan", biweekly: "Dua mingguan", monthly: "Bulanan" },
} as const;

const ROLE_LABELS = {
  en: { user: "User", admin: "Admin", super_admin: "Super admin" },
  id: { user: "Pengguna", admin: "Admin", super_admin: "Super admin" },
} as const;

export async function buildProjectDetailWorkbook({
  projectId,
  locale,
  includeTeam,
}: {
  projectId: string;
  locale: Locale;
  /**
   * The Team tab is behind `member:manage`. A workbook that carried the roster
   * regardless would hand every member's name and email to a role the UI
   * deliberately does not show them to — the export must not be the back door
   * around a permission.
   */
  includeTeam: boolean;
}) {
  const label = LABELS[locale];
  const sheetName = SHEETS[locale];

  const [row] = await db
    .select({ p: project, managerName: user.name, managerRole: user.role })
    .from(project)
    .leftJoin(user, eq(user.id, project.managerId))
    .where(eq(project.id, projectId));

  if (!row) return null;
  const { p } = row;

  const [metrics, versions, periods, tickets, members] = await Promise.all([
    boqMetricsByProject([projectId]),
    db
      .select()
      .from(boqVersion)
      .where(eq(boqVersion.projectId, projectId))
      .orderBy(desc(boqVersion.versionNo)),
    db
      .select({
        id: reportingPeriod.id,
        periodIndex: reportingPeriod.periodIndex,
        label: reportingPeriod.label,
        startDate: reportingPeriod.startDate,
        endDate: reportingPeriod.endDate,
      })
      .from(reportingPeriod)
      .where(eq(reportingPeriod.projectId, projectId))
      .orderBy(asc(reportingPeriod.periodIndex)),
    db
      .select()
      .from(ticket)
      .where(eq(ticket.projectId, projectId))
      .orderBy(desc(ticket.createdAt)),
    includeTeam
      ? db
          .select({
            name: user.name,
            email: user.email,
            role: user.role,
            addedAt: projectMember.createdAt,
          })
          .from(projectMember)
          .innerJoin(user, eq(user.id, projectMember.userId))
          .where(eq(projectMember.projectId, projectId))
          .orderBy(asc(user.name))
      : Promise.resolve([]),
  ]);

  // The baseline in force, matching what boq-metrics measures against. A draft
  // revision is somebody's work in progress and is not what the numbers on the
  // summary sheet mean.
  const active = versions.find(
    (version) => version.status === "active" && version.scheduleStatus === "active",
  );

  const [items, distribution, entries] = active
    ? await Promise.all([
        db
          .select()
          .from(boqItem)
          .where(and(eq(boqItem.boqVersionId, active.id), isNull(boqItem.deletedAt)))
          .orderBy(asc(boqItem.sortOrder), asc(boqItem.code)),
        db
          .select({
            boqItemId: boqItemDistribution.boqItemId,
            periodId: boqItemDistribution.periodId,
            plannedPct: boqItemDistribution.plannedPct,
          })
          .from(boqItemDistribution)
          .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
          .where(eq(boqItem.boqVersionId, active.id)),
        db
          .select({
            boqItemId: progressEntry.boqItemId,
            periodId: progressEntry.periodId,
            cumulativeQuantity: progressEntry.cumulativeQuantity,
            cumulativePercent: progressEntry.cumulativePercent,
            pctComplete: progressEntry.pctComplete,
          })
          .from(progressEntry)
          .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
          .where(eq(boqItem.boqVersionId, active.id)),
      ])
    : [[], [], []];

  // Shaped for the shared curve functions, which take plain numbers. Doing the
  // numeric-string conversion once here is the rule from lib/money.ts.
  const curveItems = items.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    code: item.code,
    description: item.description,
    weight: toAmount(item.weight),
    sortOrder: item.sortOrder,
  }));
  const rows = scheduleRows(curveItems);
  const cells = distributionMap(
    distribution.map((cell) => ({
      boqItemId: cell.boqItemId,
      periodId: cell.periodId,
      plannedPct: toAmount(cell.plannedPct),
    })),
  );
  const curveEntries = entries.map((entry) => ({
    boqItemId: entry.boqItemId,
    periodId: entry.periodId,
    pctComplete: toAmount(entry.pctComplete),
    cumulativeQuantity: entry.cumulativeQuantity === null ? null : toAmount(entry.cumulativeQuantity),
    cumulativePercent: entry.cumulativePercent === null ? null : toAmount(entry.cumulativePercent),
  }));

  const planned = computePlannedCurve(rows, periods, cells);
  const actual = computeActualCurve(rows, periods, curveEntries, p.dataDate);

  // Same reasoning as apps/server/src/index.ts: keep exceljs out of the module
  // graph until the moment a workbook is actually being built.
  const { default: excel } = (await import("exceljs")) as unknown as { default: typeof ExcelJS };
  const workbook = new excel.Workbook();
  workbook.created = new Date();

  const boq = metrics.get(projectId);

  /* ---------------------------------------------------------------- Summary */

  const summary = workbook.addWorksheet(sheetName.summary);
  summary.addRow([label.field, label.value]);
  summary.getRow(1).font = { bold: true };
  summary.getColumn(1).width = 26;
  summary.getColumn(2).width = 44;

  const contractValue = boq?.contractValue ?? null;
  const workCompleted = boq?.workCompletedValue ?? null;

  const summaryRows: [string, string | number | Date | null, string?][] = [
    [label.code, p.code],
    [label.project, p.name],
    [label.status, PROJECT_STATUS_LABELS[locale][p.status] ?? p.status],
    [label.client, p.client ?? ""],
    [label.location, p.location ?? ""],
    // A super admin is never named on a company's records — the same redaction
    // the portfolio export applies, and for the same reason: an export is
    // exactly where a leak goes unnoticed.
    [
      label.manager,
      row.managerName && roleOf({ role: row.managerRole }) !== "super_admin" ? row.managerName : "",
    ],
    [label.startDate, toExcelDate(p.startDate), DATE_FORMAT],
    [label.targetCompletion, toExcelDate(p.endDate), DATE_FORMAT],
    [label.periodType, PERIOD_TYPE_LABELS[locale][p.periodType] ?? p.periodType],
    [label.dataDate, toExcelDate(p.dataDate), DATE_FORMAT],
    [label.contractValue, contractValue, MONEY_FORMAT],
    [label.workCompleted, workCompleted, MONEY_FORMAT],
    [
      label.remaining,
      contractValue === null || workCompleted === null ? null : contractValue - workCompleted,
      MONEY_FORMAT,
    ],
    // Real Excel percentages, so the cell reads 42.0% and still averages.
    [label.siteProgress, (boq ? boq.progress : p.progress) / 100, PERCENT_FORMAT],
    [label.planned, boq ? boq.planned / 100 : null, PERCENT_FORMAT],
    [label.deviation, boq?.deviation == null ? null : boq.deviation / 100, PERCENT_FORMAT],
    [label.openTickets, tickets.filter((row) => row.status !== "closed").length],
    [label.notes, p.notes ?? ""],
  ];

  for (const [field, value, format] of summaryRows) {
    const added = summary.addRow([field, value]);
    added.getCell(1).font = { bold: true };
    if (format) added.getCell(2).numFmt = format;
  }

  /* -------------------------------------------------------------------- BoQ */

  const boqSheet = workbook.addWorksheet(sheetName.boq, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  boqSheet.addRow([
    label.code,
    label.description,
    label.unit,
    label.quantity,
    label.unitRate,
    label.lineValue,
    label.weight,
    label.progressMode,
  ]);
  boqSheet.getRow(1).font = { bold: true };
  [14, 46, 10, 14, 16, 18, 11, 14].forEach((width, index) => {
    boqSheet.getColumn(index + 1).width = width;
  });

  if (!active) {
    boqSheet.addRow([label.noBaseline]);
  } else {
    const leafIds = new Set(rows.map((row) => row.leaf.id));
    for (const item of items) {
      const isLeaf = leafIds.has(item.id);
      const added = boqSheet.addRow([
        item.code,
        item.description,
        item.unit ?? "",
        item.quantity === null ? null : toAmount(item.quantity),
        item.unitRate === null ? null : toAmount(item.unitRate),
        item.value === null ? null : toAmount(item.value),
        // Weight belongs to leaves only; sections are pure rollups, so printing
        // their stored zero as "0.0%" would read as a line worth nothing rather
        // than a heading.
        isLeaf ? toAmount(item.weight) / 100 : null,
        isLeaf
          ? item.progressMode === "by_percent"
            ? label.byPercent
            : label.byQuantity
          : "",
      ]);
      // Section headers carry the structure, so they are the one thing in this
      // sheet that is styled rather than left plain.
      if (!isLeaf) added.font = { bold: true };
    }

    boqSheet.getColumn(5).numFmt = MONEY_FORMAT;
    boqSheet.getColumn(6).numFmt = MONEY_FORMAT;
    boqSheet.getColumn(7).numFmt = PERCENT_FORMAT;
  }

  /* ----------------------------------------------------- Plan and Progress */

  const periodHeaders = periods.map(
    (period) => period.label ?? `${label.period} ${period.periodIndex + 1}`,
  );

  /**
   * Two sheets over one grid each, rather than one sheet with plan and actual
   * interleaved. A clean rectangle is what a pivot table and a chart range both
   * want; alternating rows would force whoever opens this to unpick it first.
   */
  function matrixSheet(name: string, cellFor: (itemId: string, periodId: string) => number | null) {
    const sheet = workbook.addWorksheet(name, {
      views: [{ state: "frozen", xSplit: 3, ySplit: 1 }],
    });
    sheet.addRow([label.section, label.code, label.description, label.weight, ...periodHeaders]);
    sheet.getRow(1).font = { bold: true };
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 14;
    sheet.getColumn(3).width = 40;
    sheet.getColumn(4).width = 11;
    periods.forEach((_, index) => {
      sheet.getColumn(index + 5).width = 12;
    });

    for (const { section, leaf } of rows) {
      sheet.addRow([
        section,
        leaf.code,
        leaf.description,
        leaf.weight / 100,
        ...periods.map((period) => {
          const value = cellFor(leaf.id, period.id);
          return value === null ? null : value / 100;
        }),
      ]);
    }

    sheet.getColumn(4).numFmt = PERCENT_FORMAT;
    periods.forEach((_, index) => {
      sheet.getColumn(index + 5).numFmt = PERCENT_FORMAT;
    });
    return sheet;
  }

  matrixSheet(sheetName.plan, (itemId, periodId) => cells.get(`${itemId}|${periodId}`) ?? null);

  // A cleared cell — both cumulative columns null — is not a reading of zero,
  // and must come out blank rather than as 0%. The same distinction the actual
  // curve turns on.
  const readings = new Map<string, number>();
  for (const entry of curveEntries) {
    if (entry.cumulativePercent === null && entry.cumulativeQuantity === null) continue;
    readings.set(`${entry.boqItemId}|${entry.periodId}`, entry.pctComplete);
  }
  matrixSheet(sheetName.progress, (itemId, periodId) => readings.get(`${itemId}|${periodId}`) ?? null);

  /* ---------------------------------------------------------------- S-curve */

  const curve = workbook.addWorksheet(sheetName.curve, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  curve.addRow([
    label.period,
    label.periodStart,
    label.periodEnd,
    label.plannedCumulative,
    label.actualCumulative,
  ]);
  curve.getRow(1).font = { bold: true };
  [14, 14, 14, 20, 20].forEach((width, index) => {
    curve.getColumn(index + 1).width = width;
  });

  periods.forEach((period, index) => {
    curve.addRow([
      period.label ?? `${label.period} ${period.periodIndex + 1}`,
      toExcelDate(period.startDate),
      toExcelDate(period.endDate),
      (planned.cumulative[index] ?? 0) / 100,
      // Left blank past the last real reading, not run flat to the end. A
      // trailing zero would draw the actual line collapsing to nothing; blank
      // reads as "not reported yet", which is what it is.
      actual.cumulative[index] === null ? null : (actual.cumulative[index] ?? 0) / 100,
    ]);
  });

  curve.getColumn(2).numFmt = DATE_FORMAT;
  curve.getColumn(3).numFmt = DATE_FORMAT;
  curve.getColumn(4).numFmt = PERCENT_FORMAT;
  curve.getColumn(5).numFmt = PERCENT_FORMAT;

  /* ---------------------------------------------------------------- Tickets */

  const ticketSheet = workbook.addWorksheet(sheetName.tickets, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ticketSheet.addRow([
    label.title,
    label.status,
    label.issuer,
    label.responsible,
    label.contact,
    label.created,
    label.updated,
    label.description,
  ]);
  ticketSheet.getRow(1).font = { bold: true };
  [36, 14, 22, 22, 18, 13, 13, 60].forEach((width, index) => {
    ticketSheet.getColumn(index + 1).width = width;
  });

  for (const row of tickets) {
    ticketSheet.addRow([
      row.title,
      TICKET_STATUS_LABELS[locale][row.status] ?? row.status,
      row.issuerName,
      row.responsibleName,
      row.responsibleContactNumber,
      row.createdAt,
      row.updatedAt,
      row.description,
    ]);
  }
  ticketSheet.getColumn(6).numFmt = DATE_FORMAT;
  ticketSheet.getColumn(7).numFmt = DATE_FORMAT;
  ticketSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };

  /* ------------------------------------------------------------------- Team */

  if (includeTeam) {
    const teamSheet = workbook.addWorksheet(sheetName.team, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    teamSheet.addRow([label.name, label.email, label.role, label.addedOn]);
    teamSheet.getRow(1).font = { bold: true };
    [28, 32, 16, 14].forEach((width, index) => {
      teamSheet.getColumn(index + 1).width = width;
    });

    for (const member of members) {
      teamSheet.addRow([
        member.name,
        member.email,
        ROLE_LABELS[locale][roleOf({ role: member.role })] ?? member.role,
        member.addedAt,
      ]);
    }
    teamSheet.getColumn(4).numFmt = DATE_FORMAT;
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return {
    // The code, not the id — the person receiving this reads "PRJ-014", and a
    // folder of UUID filenames is unusable.
    filename: `${p.code}-${todayStamp()}.xlsx`,
    body: new Uint8Array(buffer as ArrayBuffer),
  };
}
