import { boqMetricsByProject } from "@DashboardV2/api/lib/boq-metrics";
import { buildPeriodSummary, distributionMap, scheduleRows } from "@DashboardV2/api/lib/curves";
import { toAmount } from "@DashboardV2/api/lib/money";
import { roleOf } from "@DashboardV2/api/lib/permissions";
import { db } from "@DashboardV2/db";
import {
  boqItem,
  boqItemDistribution,
  boqVersion,
  dailyProgressItem,
  dailyProgressSnapshot,
  notePhoto,
  progressEntry,
  project,
  projectActualCurve,
  projectMember,
  projectNote,
  reportingPeriod,
  reportingPeriodEvent,
  ticket,
  user,
} from "@DashboardV2/db/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type ExcelJS from "exceljs";

import {
  DATE_FORMAT,
  type Locale,
  MONEY_FORMAT,
  PERCENT_FORMAT,
  PROJECT_STATUS_LABELS,
  projectWorkbookFilename,
  toExcelDate,
} from "./export-format";
import { renderProjectSCurveChart } from "./project-scurve-chart";

const DATETIME_FORMAT = "yyyy-mm-dd hh:mm";

const SHEETS = {
  en: {
    summary: "Summary",
    revisions: "Baseline Revisions",
    boq: "BoQ - All Revisions",
    plan: "Active Plan",
    progress: "Item Progress",
    chart: "S-curve Graph",
    curve: "S-curve",
    periods: "Reporting Periods",
    workflow: "Workflow History",
    tickets: "Tickets",
    notes: "Project Notes",
    photos: "Note Photos",
    daily: "Daily Progress",
    dailyItems: "Daily Progress Items",
    team: "Team",
  },
  id: {
    summary: "Ringkasan",
    revisions: "Revisi Baseline",
    boq: "RAB - Semua Revisi",
    plan: "Rencana Aktif",
    progress: "Progres Item",
    chart: "Grafik Kurva-S",
    curve: "Kurva-S",
    periods: "Periode Pelaporan",
    workflow: "Riwayat Alur Kerja",
    tickets: "Tiket",
    notes: "Catatan Proyek",
    photos: "Metadata Foto",
    daily: "Progres Harian",
    dailyItems: "Item Progres Harian",
    team: "Tim",
  },
} as const;

const LABELS = {
  en: {
    active: "Active",
    activeBaseline: "Active baseline",
    actualCumulative: "Actual cumulative",
    actualPeriod: "Actual this period",
    actualSource: "Actual source",
    addedOn: "Added on",
    approvedAt: "Approved at",
    approvedBy: "Approved by",
    assignee: "Assignee",
    baselineAt: "BoQ baselined at",
    baselineBy: "BoQ baselined by",
    baselineStatus: "BoQ status",
    boqItem: "BoQ item",
    client: "Client",
    closedAt: "Closed at",
    code: "Code",
    comment: "Comment",
    contact: "Contact",
    contractValue: "Contract value",
    created: "Created",
    current: "Current period",
    dataDate: "Data date",
    deletedAt: "Deleted at",
    description: "Description",
    deviationCumulative: "Cumulative deviation",
    deviationPeriod: "Period deviation",
    distribution: "Distribution",
    dueDate: "Due date",
    email: "Email",
    field: "Field",
    fileSize: "File size (bytes)",
    finishPeriod: "Finish period index",
    fromStatus: "From status",
    id: "ID",
    itemCount: "Items",
    itemType: "Item type",
    leaf: "Item",
    lineValue: "Value",
    location: "Location",
    lockedAt: "Locked at",
    lockedBy: "Locked by",
    manager: "Project manager",
    name: "Name",
    no: "No",
    noActiveBaseline: "No fully active baseline is available.",
    noProgress: "No-progress confirmation",
    note: "Note",
    notes: "Notes",
    openTickets: "Open tickets",
    parentCode: "Parent code",
    period: "Period",
    periodCount: "Reporting periods",
    periodEnd: "Period end",
    periodIndex: "Period index",
    periodStart: "Period start",
    periodStatus: "Period status",
    periodType: "Reporting cadence",
    photoCount: "Photos",
    photoId: "Photo ID",
    plannedCumulative: "Planned cumulative",
    plannedPeriod: "Planned this period",
    progressMode: "Measured by",
    project: "Project",
    quantity: "Quantity",
    recordedBy: "Recorded by",
    remaining: "Remaining contract value",
    resolution: "Resolution",
    returnReason: "Return reason",
    reviewComment: "Review comment",
    reviewedAt: "Reviewed at",
    reviewedBy: "Reviewed by",
    revision: "Revision",
    revisionCount: "Baseline revisions",
    revisionTitle: "Revision title",
    role: "Role",
    scheduleAt: "Schedule baselined at",
    scheduleBy: "Schedule baselined by",
    scheduleStatus: "Schedule status",
    section: "Section",
    siteProgress: "Site progress",
    size: "Size",
    sourceRevision: "Source revision",
    sourceFile: "Source file",
    sourceSheet: "Source sheet",
    sourceRow: "Source row",
    sourceColumn: "Source column",
    sourceValue: "Source value",
    startDate: "Start date",
    startPeriod: "Start period index",
    status: "Status",
    submittedAt: "Submitted at",
    submittedBy: "Submitted by",
    targetCompletion: "Target completion",
    title: "Title",
    toStatus: "To status",
    totalValue: "Total value",
    type: "Type",
    unit: "Unit",
    unitRate: "Unit rate",
    updated: "Updated",
    value: "Value",
    weight: "Weight",
    weightSource: "Weight source",
    workCompleted: "Value of work completed",
    yes: "Yes",
    author: "Author",
    body: "Note",
    contentType: "Content type",
    issuer: "Raised by",
    priority: "Priority",
    responsible: "Responsible",
    cumulativeQuantity: "Cumulative quantity",
    cumulativePercent: "Cumulative percent entered",
    resolvedPercent: "Resolved completion",
    reportDate: "Report date",
    previousPercent: "Previous completion",
    currentPercent: "Progress this day",
    remainingPercent: "Remaining completion",
    previousWeighted: "Previous weighted",
    currentWeighted: "Weighted this day",
    cumulativeWeighted: "Cumulative weighted",
    remainingWeighted: "Remaining weighted",
    remarks: "Remarks",
    sourceValues: "Normalized source values",
  },
  id: {
    active: "Aktif",
    activeBaseline: "Baseline aktif",
    actualCumulative: "Realisasi kumulatif",
    actualPeriod: "Realisasi periode ini",
    actualSource: "Sumber realisasi",
    addedOn: "Ditambahkan",
    approvedAt: "Waktu disetujui",
    approvedBy: "Disetujui oleh",
    assignee: "Penerima tugas",
    baselineAt: "Waktu baseline RAB",
    baselineBy: "Baseline RAB oleh",
    baselineStatus: "Status RAB",
    boqItem: "Item RAB",
    client: "Klien",
    closedAt: "Waktu ditutup",
    code: "Kode",
    comment: "Komentar",
    contact: "Kontak",
    contractValue: "Nilai kontrak",
    created: "Dibuat",
    current: "Periode saat ini",
    dataDate: "Tanggal data",
    deletedAt: "Waktu dihapus",
    description: "Uraian",
    deviationCumulative: "Deviasi kumulatif",
    deviationPeriod: "Deviasi periode",
    distribution: "Distribusi",
    dueDate: "Tenggat",
    email: "Email",
    field: "Keterangan",
    fileSize: "Ukuran berkas (byte)",
    finishPeriod: "Indeks periode selesai",
    fromStatus: "Dari status",
    id: "ID",
    itemCount: "Jumlah item",
    itemType: "Jenis item",
    leaf: "Item",
    lineValue: "Jumlah",
    location: "Lokasi",
    lockedAt: "Waktu dikunci",
    lockedBy: "Dikunci oleh",
    manager: "Manajer proyek",
    name: "Nama",
    no: "Tidak",
    noActiveBaseline: "Belum tersedia baseline yang aktif sepenuhnya.",
    noProgress: "Konfirmasi tanpa progres",
    note: "Catatan",
    notes: "Catatan",
    openTickets: "Tiket terbuka",
    parentCode: "Kode induk",
    period: "Periode",
    periodCount: "Periode pelaporan",
    periodEnd: "Akhir periode",
    periodIndex: "Indeks periode",
    periodStart: "Mulai periode",
    periodStatus: "Status periode",
    periodType: "Siklus pelaporan",
    photoCount: "Foto",
    photoId: "ID foto",
    plannedCumulative: "Rencana kumulatif",
    plannedPeriod: "Rencana periode ini",
    progressMode: "Diukur dengan",
    project: "Proyek",
    quantity: "Volume",
    recordedBy: "Dicatat oleh",
    remaining: "Sisa nilai kontrak",
    resolution: "Penyelesaian",
    returnReason: "Alasan dikembalikan",
    reviewComment: "Komentar tinjauan",
    reviewedAt: "Waktu ditinjau",
    reviewedBy: "Ditinjau oleh",
    revision: "Revisi",
    revisionCount: "Jumlah revisi baseline",
    revisionTitle: "Judul revisi",
    role: "Peran",
    scheduleAt: "Waktu baseline jadwal",
    scheduleBy: "Baseline jadwal oleh",
    scheduleStatus: "Status jadwal",
    section: "Bagian",
    siteProgress: "Progres lokasi",
    size: "Ukuran",
    sourceRevision: "Revisi sumber",
    sourceFile: "Berkas sumber",
    sourceSheet: "Lembar sumber",
    sourceRow: "Baris sumber",
    sourceColumn: "Kolom sumber",
    sourceValue: "Nilai sumber",
    startDate: "Tanggal mulai",
    startPeriod: "Indeks periode mulai",
    status: "Status",
    submittedAt: "Waktu diajukan",
    submittedBy: "Diajukan oleh",
    targetCompletion: "Target selesai",
    title: "Judul",
    toStatus: "Ke status",
    totalValue: "Nilai total",
    type: "Jenis",
    unit: "Satuan",
    unitRate: "Harga satuan",
    updated: "Diperbarui",
    value: "Nilai",
    weight: "Bobot",
    weightSource: "Sumber bobot",
    workCompleted: "Nilai pekerjaan terlaksana",
    yes: "Ya",
    author: "Penulis",
    body: "Catatan",
    contentType: "Jenis konten",
    issuer: "Dilaporkan oleh",
    priority: "Prioritas",
    responsible: "Penanggung jawab",
    cumulativeQuantity: "Volume kumulatif",
    cumulativePercent: "Persentase kumulatif input",
    resolvedPercent: "Progres terselesaikan",
    reportDate: "Tanggal laporan",
    previousPercent: "Penyelesaian sebelumnya",
    currentPercent: "Progres hari ini",
    remainingPercent: "Sisa penyelesaian",
    previousWeighted: "Bobot sebelumnya",
    currentWeighted: "Bobot hari ini",
    cumulativeWeighted: "Bobot kumulatif",
    remainingWeighted: "Sisa bobot",
    remarks: "Catatan",
    sourceValues: "Nilai sumber ternormalisasi",
  },
} as const;

const VALUE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    active: "Active",
    approved: "Approved",
    by_percent: "Percent",
    by_quantity: "Quantity",
    cancelled: "Cancelled",
    closed: "Closed",
    completed: "Completed",
    critical: "Critical",
    custom: "Custom",
    daily: "Daily",
    delay: "Delay",
    draft: "Draft",
    extreme_heat: "Extreme heat",
    general: "General",
    high: "High",
    imported: "Imported snapshot",
    in_progress: "In progress",
    issue: "Issue",
    itemized: "Item progress",
    light_rain: "Light rain",
    linear: "Linear",
    locked: "Locked",
    low: "Low",
    manual: "Manual",
    medium: "Medium",
    monthly: "Monthly",
    on_hold: "On hold",
    open: "Open",
    planning: "Planning",
    punch: "Punch list",
    quality: "Quality",
    quarterly: "Quarterly",
    resolved: "Resolved",
    returned: "Returned",
    reviewed: "Reviewed",
    rfi: "RFI",
    safety: "Safety",
    semimonthly: "Twice monthly",
    submitted: "Submitted",
    superseded: "Superseded",
    weekly: "Weekly",
    biweekly: "Every two weeks",
    derived: "Derived",
    user: "User",
    admin: "Admin",
    super_admin: "Super admin",
  },
  id: {
    active: "Aktif",
    approved: "Disetujui",
    by_percent: "Persen",
    by_quantity: "Volume",
    cancelled: "Dibatalkan",
    closed: "Ditutup",
    completed: "Selesai",
    critical: "Kritis",
    custom: "Khusus",
    daily: "Harian",
    delay: "Keterlambatan",
    draft: "Draf",
    extreme_heat: "Panas ekstrem",
    general: "Umum",
    high: "Tinggi",
    imported: "Snapshot impor",
    in_progress: "Dikerjakan",
    issue: "Masalah",
    itemized: "Progres item",
    light_rain: "Hujan ringan",
    linear: "Linier",
    locked: "Dikunci",
    low: "Rendah",
    manual: "Manual",
    medium: "Sedang",
    monthly: "Bulanan",
    on_hold: "Ditunda",
    open: "Terbuka",
    planning: "Perencanaan",
    punch: "Daftar perbaikan",
    quality: "Mutu",
    quarterly: "Triwulanan",
    resolved: "Selesai",
    returned: "Dikembalikan",
    reviewed: "Ditinjau",
    rfi: "RFI",
    safety: "Keselamatan",
    semimonthly: "Dua kali sebulan",
    submitted: "Diajukan",
    superseded: "Digantikan",
    weekly: "Mingguan",
    biweekly: "Setiap dua minggu",
    derived: "Turunan",
    user: "Pengguna",
    admin: "Admin",
    super_admin: "Super admin",
  },
};

function localized(locale: Locale, value: string | null | undefined) {
  return value ? (VALUE_LABELS[locale][value] ?? value) : "";
}

function styleTable(
  sheet: ExcelJS.Worksheet,
  headers: readonly string[],
  widths: readonly number[],
) {
  sheet.addRow([...headers]);
  const header = sheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { vertical: "middle", wrapText: true };
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
}

function finishTable(sheet: ExcelJS.Worksheet) {
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
  });
}

/**
 * Builds one authorized project's complete workbook. Authorization is owned by
 * the POST route; keeping this function data-focused also lets the batch export
 * call it repeatedly without creating a second, drifting access rule.
 */
export async function buildProjectDetailWorkbook({
  projectId,
  locale,
  includeTeam,
}: {
  projectId: string;
  locale: Locale;
  includeTeam: boolean;
}) {
  const label = LABELS[locale];
  const names = SHEETS[locale];

  const [projectRow] = await db
    .select({ p: project, managerName: user.name, managerRole: user.role })
    .from(project)
    .leftJoin(user, eq(user.id, project.managerId))
    .where(eq(project.id, projectId));
  if (!projectRow) return null;
  const { p } = projectRow;

  const [
    metrics,
    versions,
    periods,
    tickets,
    notes,
    photos,
    snapshots,
    workflow,
    members,
    dailySnapshots,
    dailyItems,
  ] =
    await Promise.all([
      boqMetricsByProject([projectId]),
      db
        .select()
        .from(boqVersion)
        .where(eq(boqVersion.projectId, projectId))
        .orderBy(desc(boqVersion.versionNo)),
      db
        .select()
        .from(reportingPeriod)
        .where(eq(reportingPeriod.projectId, projectId))
        .orderBy(asc(reportingPeriod.periodIndex)),
      db.select().from(ticket).where(eq(ticket.projectId, projectId)).orderBy(desc(ticket.createdAt)),
      db
        .select()
        .from(projectNote)
        .where(eq(projectNote.projectId, projectId))
        .orderBy(desc(projectNote.createdAt)),
      db
        .select({
          id: notePhoto.id,
          noteId: notePhoto.noteId,
          contentType: notePhoto.contentType,
          size: notePhoto.size,
          createdAt: notePhoto.createdAt,
        })
        .from(notePhoto)
        .innerJoin(projectNote, eq(projectNote.id, notePhoto.noteId))
        .where(eq(projectNote.projectId, projectId))
        .orderBy(desc(notePhoto.createdAt)),
      db
        .select()
        .from(projectActualCurve)
        .where(eq(projectActualCurve.projectId, projectId)),
      db
        .select({ event: reportingPeriodEvent, periodIndex: reportingPeriod.periodIndex })
        .from(reportingPeriodEvent)
        .innerJoin(reportingPeriod, eq(reportingPeriod.id, reportingPeriodEvent.periodId))
        .where(eq(reportingPeriod.projectId, projectId))
        .orderBy(asc(reportingPeriod.periodIndex), asc(reportingPeriodEvent.createdAt)),
      includeTeam
        ? db
            .select({
              id: user.id,
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
      db
        .select()
        .from(dailyProgressSnapshot)
        .where(eq(dailyProgressSnapshot.projectId, projectId))
        .orderBy(asc(dailyProgressSnapshot.reportDate)),
      db
        .select({ item: dailyProgressItem, reportDate: dailyProgressSnapshot.reportDate })
        .from(dailyProgressItem)
        .innerJoin(
          dailyProgressSnapshot,
          eq(dailyProgressSnapshot.id, dailyProgressItem.snapshotId),
        )
        .where(eq(dailyProgressSnapshot.projectId, projectId))
        .orderBy(asc(dailyProgressSnapshot.reportDate), asc(dailyProgressItem.sourceRow)),
    ]);

  const versionIds = versions.map((version) => version.id);
  const allItems = versionIds.length
    ? await db
        .select({ item: boqItem, versionNo: boqVersion.versionNo, versionTitle: boqVersion.title })
        .from(boqItem)
        .innerJoin(boqVersion, eq(boqVersion.id, boqItem.boqVersionId))
        .where(inArray(boqItem.boqVersionId, versionIds))
        .orderBy(desc(boqVersion.versionNo), asc(boqItem.sortOrder), asc(boqItem.code))
    : [];

  const [progress, distributions] = await Promise.all([
    versionIds.length
      ? db
          .select({
            entry: progressEntry,
            itemCode: boqItem.code,
            itemDescription: boqItem.description,
            itemSortOrder: boqItem.sortOrder,
            versionNo: boqVersion.versionNo,
            versionTitle: boqVersion.title,
            periodIndex: reportingPeriod.periodIndex,
            periodLabel: reportingPeriod.label,
            periodStart: reportingPeriod.startDate,
            periodEnd: reportingPeriod.endDate,
          })
          .from(progressEntry)
          .innerJoin(boqItem, eq(boqItem.id, progressEntry.boqItemId))
          .innerJoin(boqVersion, eq(boqVersion.id, boqItem.boqVersionId))
          .innerJoin(reportingPeriod, eq(reportingPeriod.id, progressEntry.periodId))
          .where(and(eq(progressEntry.projectId, projectId), inArray(boqItem.boqVersionId, versionIds)))
          .orderBy(
            asc(boqVersion.versionNo),
            asc(reportingPeriod.periodIndex),
            asc(boqItem.sortOrder),
          )
      : Promise.resolve([]),
    versionIds.length
      ? db
          .select({
            boqVersionId: boqItem.boqVersionId,
            boqItemId: boqItemDistribution.boqItemId,
            periodId: boqItemDistribution.periodId,
            plannedPct: boqItemDistribution.plannedPct,
          })
          .from(boqItemDistribution)
          .innerJoin(boqItem, eq(boqItem.id, boqItemDistribution.boqItemId))
          .where(inArray(boqItem.boqVersionId, versionIds))
      : Promise.resolve([]),
  ]);

  const actorIds = new Set<string>();
  for (const version of versions) {
    if (version.baselinedById) actorIds.add(version.baselinedById);
    if (version.scheduleBaselinedById) actorIds.add(version.scheduleBaselinedById);
  }
  for (const period of periods) {
    for (const id of [
      period.submittedById,
      period.reviewedById,
      period.approvedById,
      period.lockedById,
    ]) {
      if (id) actorIds.add(id);
    }
  }
  for (const row of progress) if (row.entry.recordedById) actorIds.add(row.entry.recordedById);
  for (const row of tickets) if (row.assigneeId) actorIds.add(row.assigneeId);

  const actors = actorIds.size
    ? await db
        .select({ id: user.id, name: user.name })
        .from(user)
        .where(inArray(user.id, [...actorIds]))
    : [];
  const actorName = new Map(actors.map((actor) => [actor.id, actor.name]));

  const activeVersion = versions.find(
    (version) => version.status === "active" && version.scheduleStatus === "active",
  );
  const itemVersionById = new Map(
    allItems.map((row) => [row.item.id, row.item.boqVersionId]),
  );
  const activeItemRows = activeVersion
    ? allItems.filter(
        (row) => row.item.boqVersionId === activeVersion.id && row.item.deletedAt === null,
      )
    : [];
  const curveItems = activeItemRows.map(({ item }) => ({
    id: item.id,
    parentId: item.parentId,
    code: item.code,
    description: item.description,
    weight: toAmount(item.weight),
    sortOrder: item.sortOrder,
  }));
  const curveRows = scheduleRows(curveItems);
  const activeDistributions = activeVersion
    ? distributions.filter((cell) => cell.boqVersionId === activeVersion.id)
    : [];
  const cells = distributionMap(
    activeDistributions.map((cell) => ({
      boqItemId: cell.boqItemId,
      periodId: cell.periodId,
      plannedPct: toAmount(cell.plannedPct),
    })),
  );
  const curveEntries = progress
    .filter((row) => activeVersion?.id === itemVersionById.get(row.entry.boqItemId))
    .map(({ entry }) => ({
      boqItemId: entry.boqItemId,
      periodId: entry.periodId,
      pctComplete: toAmount(entry.pctComplete),
      cumulativeQuantity:
        entry.cumulativeQuantity === null ? null : toAmount(entry.cumulativeQuantity),
      cumulativePercent:
        entry.cumulativePercent === null ? null : toAmount(entry.cumulativePercent),
    }));
  const periodSummary = buildPeriodSummary(
    curveRows,
    periods,
    cells,
    curveEntries,
    p.dataDate,
    snapshots.map((snapshot) => ({
      periodId: snapshot.periodId,
      cumulativePercent: toAmount(snapshot.cumulativePercent),
    })),
  );
  const snapshotByPeriod = new Map(snapshots.map((snapshot) => [snapshot.periodId, snapshot]));

  const { default: excel } = (await import("exceljs")) as unknown as { default: typeof ExcelJS };
  const workbook = new excel.Workbook();
  workbook.creator = "DashboardV2";
  workbook.created = new Date();
  workbook.modified = new Date();

  /* Summary */
  const summary = workbook.addWorksheet(names.summary, { views: [{ state: "frozen", ySplit: 1 }] });
  styleTable(summary, [label.field, label.value], [30, 52]);
  const boq = metrics.get(projectId);
  const contractValue = boq?.contractValue ?? null;
  const workCompleted = boq?.workCompletedValue ?? null;
  const summaryRows: [string, string | number | Date | null, string?][] = [
    [label.code, p.code],
    [label.project, p.name],
    [label.status, PROJECT_STATUS_LABELS[locale][p.status] ?? p.status],
    [label.client, p.client ?? ""],
    [label.location, p.location ?? ""],
    [
      label.manager,
      projectRow.managerName && roleOf({ role: projectRow.managerRole }) !== "super_admin"
        ? projectRow.managerName
        : "",
    ],
    [label.startDate, toExcelDate(p.startDate), DATE_FORMAT],
    [label.targetCompletion, toExcelDate(p.endDate), DATE_FORMAT],
    [label.periodType, localized(locale, p.periodType)],
    [label.dataDate, toExcelDate(p.dataDate), DATE_FORMAT],
    [label.contractValue, contractValue, MONEY_FORMAT],
    [label.workCompleted, workCompleted, MONEY_FORMAT],
    [
      label.remaining,
      contractValue === null || workCompleted === null ? null : contractValue - workCompleted,
      MONEY_FORMAT,
    ],
    [label.siteProgress, (boq ? boq.progress : p.progress) / 100, PERCENT_FORMAT],
    [label.plannedCumulative, boq ? boq.planned / 100 : null, PERCENT_FORMAT],
    [label.deviationCumulative, boq?.deviation == null ? null : boq.deviation / 100, PERCENT_FORMAT],
    [label.openTickets, tickets.filter((row) => row.status !== "closed").length],
    [label.revisionCount, versions.length],
    [label.activeBaseline, activeVersion ? `R${activeVersion.versionNo} - ${activeVersion.title}` : ""],
    [label.periodCount, periods.length],
    [label.notes, p.notes ?? ""],
  ];
  for (const [field, value, format] of summaryRows) {
    const row = summary.addRow([field, value]);
    row.getCell(1).font = { bold: true };
    if (format) row.getCell(2).numFmt = format;
  }
  finishTable(summary);

  /* Printable visual overview. The editable source values remain in S-curve. */
  const chartSheet = workbook.addWorksheet(names.chart, {
    properties: { showGridLines: false },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 1 },
  });
  chartSheet.mergeCells("A1:N1");
  const chartTitle = chartSheet.getCell("A1");
  chartTitle.value = `${p.name} (${p.code})`;
  chartTitle.font = { bold: true, size: 18, color: { argb: "FF173D43" } };
  chartTitle.alignment = { vertical: "middle" };
  chartSheet.getRow(1).height = 30;
  chartSheet.getCell("A2").value = label.dataDate;
  chartSheet.getCell("A2").font = { bold: true };
  chartSheet.getCell("B2").value = toExcelDate(p.dataDate);
  chartSheet.getCell("B2").numFmt = DATE_FORMAT;
  chartSheet.getCell("D2").value = label.plannedCumulative;
  chartSheet.getCell("D2").font = { bold: true, color: { argb: "FFC27B18" } };
  chartSheet.getCell("G2").value = label.actualCumulative;
  chartSheet.getCell("G2").font = { bold: true, color: { argb: "FF10666F" } };
  chartSheet.getCell("J2").value = label.deviationCumulative;
  chartSheet.getCell("J2").font = { bold: true };
  const latest = periodSummary.findLast((row) => row.actualCumulative !== null) ?? periodSummary.at(-1);
  chartSheet.getCell("E2").value = latest ? latest.plannedCumulative / 100 : null;
  chartSheet.getCell("H2").value = latest?.actualCumulative == null ? null : latest.actualCumulative / 100;
  chartSheet.getCell("K2").value = latest?.deviationCumulative == null ? null : latest.deviationCumulative / 100;
  for (const address of ["E2", "H2", "K2"]) chartSheet.getCell(address).numFmt = PERCENT_FORMAT;
  for (let column = 1; column <= 14; column += 1) chartSheet.getColumn(column).width = 12;
  if (periodSummary.length > 0) {
    const imageId = workbook.addImage({
      base64: `data:image/png;base64,${Buffer.from(
        renderProjectSCurveChart(
          periodSummary.map((row) => ({
            planned: row.plannedCumulative,
            actual: row.actualCumulative,
            isCurrent: row.isCurrent,
          })),
        ),
      ).toString("base64")}`,
      extension: "png",
    });
    chartSheet.addImage(imageId, { tl: { col: 0, row: 3 }, ext: { width: 1100, height: 550 } });
  } else {
    chartSheet.getCell("A4").value = label.noActiveBaseline;
  }

  /* Baseline revision metadata */
  const revisionSheet = workbook.addWorksheet(names.revisions, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    revisionSheet,
    [
      label.revision,
      label.revisionTitle,
      label.baselineStatus,
      label.scheduleStatus,
      label.active,
      label.sourceRevision,
      label.totalValue,
      label.itemCount,
      label.baselineAt,
      label.baselineBy,
      label.scheduleAt,
      label.scheduleBy,
      label.created,
      label.updated,
    ],
    [10, 32, 16, 16, 10, 14, 18, 10, 18, 22, 18, 22, 18, 18],
  );
  const versionById = new Map(versions.map((version) => [version.id, version]));
  for (const version of versions) {
    revisionSheet.addRow([
      version.versionNo,
      version.title,
      localized(locale, version.status),
      localized(locale, version.scheduleStatus),
      version.id === activeVersion?.id ? label.yes : label.no,
      version.sourceVersionId ? (versionById.get(version.sourceVersionId)?.versionNo ?? "") : "",
      version.totalValue === null ? null : toAmount(version.totalValue),
      allItems.filter((row) => row.item.boqVersionId === version.id).length,
      version.baselinedAt,
      version.baselinedById ? (actorName.get(version.baselinedById) ?? "") : "",
      version.scheduleBaselinedAt,
      version.scheduleBaselinedById
        ? (actorName.get(version.scheduleBaselinedById) ?? "")
        : "",
      version.createdAt,
      version.updatedAt,
    ]);
  }
  revisionSheet.getColumn(7).numFmt = MONEY_FORMAT;
  for (const index of [9, 11, 13, 14]) revisionSheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(revisionSheet);

  /* Every item from every revision, including soft-deleted draft history. */
  const boqSheet = workbook.addWorksheet(names.boq, { views: [{ state: "frozen", ySplit: 1 }] });
  styleTable(
    boqSheet,
    [
      label.revision,
      label.revisionTitle,
      label.code,
      label.parentCode,
      label.itemType,
      label.description,
      label.unit,
      label.quantity,
      label.unitRate,
      label.lineValue,
      label.weight,
      label.weightSource,
      label.progressMode,
      label.distribution,
      label.startPeriod,
      label.finishPeriod,
      label.deletedAt,
    ],
    [10, 28, 14, 14, 12, 48, 10, 14, 16, 18, 11, 15, 15, 15, 13, 13, 18],
  );
  const itemById = new Map(allItems.map((row) => [row.item.id, row.item]));
  const parentIds = new Set(allItems.filter((row) => row.item.parentId).map((row) => row.item.parentId));
  for (const { item, versionNo, versionTitle } of allItems) {
    const row = boqSheet.addRow([
      versionNo,
      versionTitle,
      item.code,
      item.parentId ? (itemById.get(item.parentId)?.code ?? "") : "",
      parentIds.has(item.id) ? label.section : label.leaf,
      item.description,
      item.unit ?? "",
      item.quantity === null ? null : toAmount(item.quantity),
      item.unitRate === null ? null : toAmount(item.unitRate),
      item.value === null ? null : toAmount(item.value),
      parentIds.has(item.id) ? null : toAmount(item.weight) / 100,
      localized(locale, item.weightSource),
      localized(locale, item.progressMode),
      localized(locale, item.distribution),
      item.plannedStartPeriodIndex,
      item.plannedFinishPeriodIndex,
      item.deletedAt,
    ]);
    if (parentIds.has(item.id)) row.font = { bold: true };
  }
  for (const index of [9, 10]) boqSheet.getColumn(index).numFmt = MONEY_FORMAT;
  boqSheet.getColumn(11).numFmt = PERCENT_FORMAT;
  boqSheet.getColumn(17).numFmt = DATETIME_FORMAT;
  finishTable(boqSheet);

  /* Active plan matrix */
  const planSheet = workbook.addWorksheet(names.plan, {
    views: [{ state: "frozen", xSplit: 4, ySplit: 1 }],
  });
  const periodHeaders = periods.map(
    (period) => period.label ?? `${label.period} ${period.periodIndex + 1}`,
  );
  styleTable(
    planSheet,
    [label.section, label.code, label.description, label.weight, ...periodHeaders],
    [28, 14, 44, 11, ...periods.map(() => 12)],
  );
  if (!activeVersion) {
    planSheet.addRow([label.noActiveBaseline]);
  } else {
    for (const row of curveRows) {
      planSheet.addRow([
        row.section,
        row.leaf.code,
        row.leaf.description,
        row.leaf.weight / 100,
        ...periods.map((period) => {
          const value = cells.get(`${row.leaf.id}|${period.id}`);
          return value === undefined ? null : value / 100;
        }),
      ]);
    }
  }
  planSheet.getColumn(4).numFmt = PERCENT_FORMAT;
  periods.forEach((_, index) => {
    planSheet.getColumn(index + 5).numFmt = PERCENT_FORMAT;
  });
  finishTable(planSheet);

  /* Item-level progress readings across all revisions. */
  const progressSheet = workbook.addWorksheet(names.progress, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    progressSheet,
    [
      label.revision,
      label.revisionTitle,
      label.code,
      label.description,
      label.period,
      label.periodStart,
      label.periodEnd,
      label.cumulativeQuantity,
      label.cumulativePercent,
      label.resolvedPercent,
      label.noProgress,
      label.note,
      label.recordedBy,
      label.created,
      label.updated,
    ],
    [10, 26, 14, 42, 14, 13, 13, 18, 18, 16, 16, 40, 22, 18, 18],
  );
  for (const row of progress) {
    progressSheet.addRow([
      row.versionNo,
      row.versionTitle,
      row.itemCode,
      row.itemDescription,
      row.periodLabel ?? `${label.period} ${row.periodIndex + 1}`,
      toExcelDate(row.periodStart),
      toExcelDate(row.periodEnd),
      row.entry.cumulativeQuantity === null ? null : toAmount(row.entry.cumulativeQuantity),
      row.entry.cumulativePercent === null ? null : toAmount(row.entry.cumulativePercent) / 100,
      toAmount(row.entry.pctComplete) / 100,
      row.entry.noProgress ? label.yes : label.no,
      row.entry.note ?? "",
      row.entry.recordedById ? (actorName.get(row.entry.recordedById) ?? "") : "",
      row.entry.createdAt,
      row.entry.updatedAt,
    ]);
  }
  for (const index of [6, 7]) progressSheet.getColumn(index).numFmt = DATE_FORMAT;
  for (const index of [9, 10]) progressSheet.getColumn(index).numFmt = PERCENT_FORMAT;
  for (const index of [14, 15]) progressSheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(progressSheet);

  /* S-curve source data, including imported project snapshots. */
  const curveSheet = workbook.addWorksheet(names.curve, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    curveSheet,
    [
      label.period,
      label.periodStart,
      label.periodEnd,
      label.periodStatus,
      label.plannedPeriod,
      label.actualPeriod,
      label.plannedCumulative,
      label.actualCumulative,
      label.deviationPeriod,
      label.deviationCumulative,
      label.actualSource,
      label.sourceFile,
      label.sourceSheet,
      label.sourceRow,
      label.sourceColumn,
      label.sourceValue,
      label.current,
    ],
    [14, 13, 13, 15, 18, 18, 20, 20, 18, 20, 20, 30, 24, 12, 14, 20, 14],
  );
  for (const row of periodSummary) {
    const snapshot = snapshotByPeriod.get(row.period.id);
    curveSheet.addRow([
      row.period.label ?? `${label.period} ${row.period.periodIndex + 1}`,
      toExcelDate(row.period.startDate),
      toExcelDate(row.period.endDate),
      localized(locale, row.period.status),
      row.plannedPeriod / 100,
      row.actualPeriod === null ? null : row.actualPeriod / 100,
      row.plannedCumulative / 100,
      row.actualCumulative === null ? null : row.actualCumulative / 100,
      row.deviationPeriod === null ? null : row.deviationPeriod / 100,
      row.deviationCumulative === null ? null : row.deviationCumulative / 100,
      localized(locale, row.actualSource),
      snapshot?.sourceFilename ?? "",
      snapshot?.sourceSheetName ?? "",
      snapshot?.sourceRow ?? "",
      snapshot?.sourceColumn ?? "",
      snapshot?.sourceValue ?? "",
      row.isCurrent ? label.yes : label.no,
    ]);
  }
  for (const index of [2, 3]) curveSheet.getColumn(index).numFmt = DATE_FORMAT;
  for (const index of [5, 6, 7, 8, 9, 10]) curveSheet.getColumn(index).numFmt = PERCENT_FORMAT;
  finishTable(curveSheet);

  /* Every dated workbook snapshot and its full source-line detail. */
  const dailySheet = workbook.addWorksheet(names.daily, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    dailySheet,
    [
      label.reportDate,
      label.period,
      label.actualCumulative,
      label.sourceFile,
      label.sourceSheet,
      label.created,
      label.updated,
    ],
    [14, 14, 20, 34, 26, 18, 18],
  );
  for (const snapshot of dailySnapshots) {
    const period = periods.find((candidate) => candidate.id === snapshot.periodId);
    dailySheet.addRow([
      toExcelDate(snapshot.reportDate),
      period?.label ?? (period ? `${label.period} ${period.periodIndex + 1}` : ""),
      toAmount(snapshot.cumulativePercent) / 100,
      snapshot.sourceFilename,
      snapshot.sourceSheetName,
      snapshot.createdAt,
      snapshot.updatedAt,
    ]);
  }
  dailySheet.getColumn(1).numFmt = DATE_FORMAT;
  dailySheet.getColumn(3).numFmt = PERCENT_FORMAT;
  for (const index of [6, 7]) dailySheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(dailySheet);

  const dailyItemSheet = workbook.addWorksheet(names.dailyItems, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    dailyItemSheet,
    [
      label.reportDate,
      label.sourceRow,
      label.code,
      label.description,
      label.unit,
      label.quantity,
      label.unitRate,
      label.lineValue,
      label.weight,
      label.previousPercent,
      label.currentPercent,
      label.cumulativePercent,
      label.remainingPercent,
      label.previousWeighted,
      label.currentWeighted,
      label.cumulativeWeighted,
      label.remainingWeighted,
      label.remarks,
      label.sourceValues,
    ],
    [14, 12, 14, 48, 10, 14, 16, 18, 11, 18, 16, 18, 18, 18, 16, 18, 18, 42, 72],
  );
  for (const { item, reportDate } of dailyItems) {
    dailyItemSheet.addRow([
      toExcelDate(reportDate),
      item.sourceRow,
      item.code ?? "",
      item.description,
      item.unit ?? "",
      item.quantity === null ? null : toAmount(item.quantity),
      item.unitRate === null ? null : toAmount(item.unitRate),
      item.amount === null ? null : toAmount(item.amount),
      toAmount(item.weight) / 100,
      item.previousPercent === null ? null : toAmount(item.previousPercent) / 100,
      item.currentPercent === null ? null : toAmount(item.currentPercent) / 100,
      toAmount(item.cumulativePercent) / 100,
      item.remainingPercent === null ? null : toAmount(item.remainingPercent) / 100,
      item.previousWeighted === null ? null : toAmount(item.previousWeighted) / 100,
      item.currentWeighted === null ? null : toAmount(item.currentWeighted) / 100,
      toAmount(item.cumulativeWeighted) / 100,
      item.remainingWeighted === null ? null : toAmount(item.remainingWeighted) / 100,
      item.remark ?? "",
      JSON.stringify(item.sourceValues),
    ]);
  }
  dailyItemSheet.getColumn(1).numFmt = DATE_FORMAT;
  for (const index of [7, 8]) dailyItemSheet.getColumn(index).numFmt = MONEY_FORMAT;
  for (const index of [9, 10, 11, 12, 13, 14, 15, 16, 17]) {
    dailyItemSheet.getColumn(index).numFmt = PERCENT_FORMAT;
  }
  finishTable(dailyItemSheet);

  /* Current reporting-period workflow state. */
  const periodSheet = workbook.addWorksheet(names.periods, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    periodSheet,
    [
      label.periodIndex,
      label.period,
      label.periodStart,
      label.periodEnd,
      label.periodStatus,
      label.submittedBy,
      label.submittedAt,
      label.reviewedBy,
      label.reviewedAt,
      label.approvedBy,
      label.approvedAt,
      label.lockedBy,
      label.lockedAt,
      label.returnReason,
      label.reviewComment,
      label.created,
      label.updated,
    ],
    [12, 14, 13, 13, 15, 22, 18, 22, 18, 22, 18, 22, 18, 42, 42, 18, 18],
  );
  for (const period of periods) {
    periodSheet.addRow([
      period.periodIndex,
      period.label ?? `${label.period} ${period.periodIndex + 1}`,
      toExcelDate(period.startDate),
      toExcelDate(period.endDate),
      localized(locale, period.status),
      period.submittedById ? (actorName.get(period.submittedById) ?? "") : "",
      period.submittedAt,
      period.reviewedById ? (actorName.get(period.reviewedById) ?? "") : "",
      period.reviewedAt,
      period.approvedById ? (actorName.get(period.approvedById) ?? "") : "",
      period.approvedAt,
      period.lockedById ? (actorName.get(period.lockedById) ?? "") : "",
      period.lockedAt,
      period.returnReason ?? "",
      period.reviewComment ?? "",
      period.createdAt,
      period.updatedAt,
    ]);
  }
  for (const index of [3, 4]) periodSheet.getColumn(index).numFmt = DATE_FORMAT;
  for (const index of [7, 9, 11, 13, 16, 17])
    periodSheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(periodSheet);

  /* Append-only workflow history. */
  const workflowSheet = workbook.addWorksheet(names.workflow, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    workflowSheet,
    [label.periodIndex, label.period, label.fromStatus, label.toStatus, label.author, label.comment, label.created],
    [12, 16, 16, 16, 24, 52, 18],
  );
  const periodById = new Map(periods.map((period) => [period.id, period]));
  for (const { event } of workflow) {
    const period = periodById.get(event.periodId);
    workflowSheet.addRow([
      period?.periodIndex ?? "",
      period?.label ?? (period ? `${label.period} ${period.periodIndex + 1}` : ""),
      localized(locale, event.fromStatus),
      localized(locale, event.toStatus),
      event.actorName,
      event.comment ?? "",
      event.createdAt,
    ]);
  }
  workflowSheet.getColumn(7).numFmt = DATETIME_FORMAT;
  finishTable(workflowSheet);

  /* Tickets */
  const ticketSheet = workbook.addWorksheet(names.tickets, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    ticketSheet,
    [
      label.id,
      label.title,
      label.type,
      label.priority,
      label.status,
      label.dueDate,
      label.issuer,
      label.responsible,
      label.contact,
      label.assignee,
      label.boqItem,
      label.period,
      label.created,
      label.updated,
      label.closedAt,
      label.resolution,
      label.description,
    ],
    [36, 36, 15, 14, 15, 13, 22, 22, 18, 22, 14, 14, 18, 18, 18, 42, 58],
  );
  for (const row of tickets) {
    const item = row.boqItemId ? itemById.get(row.boqItemId) : undefined;
    const period = row.periodId ? periodById.get(row.periodId) : undefined;
    ticketSheet.addRow([
      row.id,
      row.title,
      localized(locale, row.type),
      localized(locale, row.priority),
      localized(locale, row.status),
      toExcelDate(row.dueDate),
      row.issuerName,
      row.responsibleName,
      row.responsibleContactNumber,
      row.assigneeId ? (actorName.get(row.assigneeId) ?? "") : "",
      item?.code ?? "",
      period?.label ?? "",
      row.createdAt,
      row.updatedAt,
      row.closedAt,
      row.resolution ?? "",
      row.description,
    ]);
  }
  ticketSheet.getColumn(6).numFmt = DATE_FORMAT;
  for (const index of [13, 14, 15]) ticketSheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(ticketSheet);

  /* Project notes and photo metadata; image bytes intentionally stay out. */
  const noteSheet = workbook.addWorksheet(names.notes, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    noteSheet,
    [label.id, label.author, label.body, label.photoCount, label.created, label.updated],
    [36, 24, 72, 12, 18, 18],
  );
  const photoCount = new Map<string, number>();
  for (const photo of photos) photoCount.set(photo.noteId, (photoCount.get(photo.noteId) ?? 0) + 1);
  for (const note of notes) {
    noteSheet.addRow([
      note.id,
      note.authorName,
      note.body,
      photoCount.get(note.id) ?? 0,
      note.createdAt,
      note.updatedAt,
    ]);
  }
  for (const index of [5, 6]) noteSheet.getColumn(index).numFmt = DATETIME_FORMAT;
  finishTable(noteSheet);

  const photoSheet = workbook.addWorksheet(names.photos, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  styleTable(
    photoSheet,
    [label.photoId, label.note, label.contentType, label.fileSize, label.created],
    [36, 36, 24, 18, 18],
  );
  for (const photo of photos) {
    photoSheet.addRow([
      photo.id,
      photo.noteId,
      photo.contentType,
      photo.size,
      photo.createdAt,
    ]);
  }
  photoSheet.getColumn(5).numFmt = DATETIME_FORMAT;
  finishTable(photoSheet);

  /* Team is the only permission-conditional sheet. */
  if (includeTeam) {
    const teamSheet = workbook.addWorksheet(names.team, {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    styleTable(teamSheet, [label.name, label.email, label.role, label.addedOn], [30, 36, 18, 18]);
    for (const member of members) {
      teamSheet.addRow([
        member.name,
        member.email,
        localized(locale, roleOf({ role: member.role })),
        member.addedAt,
      ]);
    }
    teamSheet.getColumn(4).numFmt = DATETIME_FORMAT;
    finishTable(teamSheet);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    filename: projectWorkbookFilename(p.name, p.code),
    body: new Uint8Array(buffer as ArrayBuffer),
  };
}
