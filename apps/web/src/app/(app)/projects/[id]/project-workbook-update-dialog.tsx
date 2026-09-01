"use client";

import { env } from "@DashboardV2/env/web";
import {
  MAX_AI_PDF_BYTES,
  MAX_AI_WORKBOOK_BYTES,
} from "@DashboardV2/api/lib/workbook-limits";
import { Alert, AlertDescription, AlertTitle } from "@DashboardV2/ui/components/alert";
import { Button } from "@DashboardV2/ui/components/button";
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { Loader2, TriangleAlert } from "@DashboardV2/ui/components/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { uploadPrivateBlob } from "@/lib/client-blob-upload";
import { getServerUrl } from "@/lib/server-url";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";
// A colon is forbidden in Excel worksheet names, so this cannot collide with a real sheet.
const AUTO_SHEET = ":entire-workbook";

type ValidationError = { row: number; column: string | null; message: string };

type SheetCandidate = {
  sheetName: string;
  state: "visible" | "hidden" | "veryHidden";
  rowCount: number;
  columnCount: number;
  knownSCurve: boolean;
  warnings: ValidationError[];
  actualSnapshotCount: number;
  latestActualPeriodIndex: number | null;
  latestActualPercent: number | null;
};

/** The fields this flow reviews from the shared workbook analysis response. */
type WorkbookAnalysis = {
  plan: {
    profile: "reference-s-curve" | "generic-ai" | "generic-deterministic" | "pdf-ai";
    periodCount: number;
    warnings: string[];
    suggestedCode: string | null;
    suggestedName: string | null;
    suggestedClient: string | null;
    suggestedLocation: string | null;
    weeklyProgress?: {
      version: 1;
      detailSheetCount: number;
      categoryCount: number;
      previousPeriodIndex: number;
      currentPeriodIndex: number;
    } | null;
  };
  summary: {
    sectionCount: number;
    lineCount: number;
    scheduledCount: number;
    totalAmount: number;
    totalWeight: number;
    actualSnapshotCount: number;
    latestActualPercent: number | null;
    latestActualPeriodIndex: number | null;
    validationErrors: ValidationError[];
  };
  actualSnapshots: {
    periodIndex: number;
    cumulativePercent: number;
    sourceRow: number;
    sourceColumn: number;
    sourceValue: string;
    sourceLabel?: string;
  }[];
  pdfActualPreview?: {
    page: number;
    table: string;
    sourceRow: number;
    periodIndex: number;
    cumulativePercent: number;
    sourceValue: string;
  }[];
  rowPreview: {
    row: number;
    sourcePage?: number;
    sourceSheet?: string;
    sourceTable?: string;
    sourceRow?: number;
    description: string;
    kind: "item" | "section" | "excluded";
    parentRow: number | null;
    code: string | null;
    unit: string | null;
    quantity: number | null;
    unitRate: number | null;
    amount: number | null;
    weight: number | null;
    startPeriodIndex: number | null;
    finishPeriodIndex: number | null;
  }[];
  currentProject: {
    code: string;
    name: string;
    client: string | null;
    location: string | null;
    startDate: string | null;
    scheduleStart: string | null;
    endDate: string | null;
    periodType: string;
    periodLengthDays: number | null;
  };
  existingActualSnapshots: {
    periodIndex: number;
    cumulativePercent: number;
  }[];
  reviewState: {
    project: {
      code: string;
      name: string;
      client: string | null;
      location: string | null;
      startDate: string | null;
      scheduleStart: string | null;
      endDate: string | null;
      periodType: string;
      periodLengthDays: number | null;
    };
    existingActualSnapshots: {
      periodIndex: number;
      cumulativePercent: number;
    }[];
    activeVersionId: string | null;
    progressEntryCount: number;
    latestProgressUpdatedAt: string | null;
    signature: string;
  };
};

export type WorkbookUpdateResult = {
  sectionsUpdated: ("projectDetails" | "boq" | "schedule" | "progress")[];
  rowsImported: number;
  periodCount: number;
  actualSnapshotCount: number;
  draftVersionId: string | null;
  versionNo: number | null;
  warnings: string[];
};

type Sections = {
  projectDetails: boolean;
  boq: boolean;
  schedule: boolean;
  progress: boolean;
};

type ApiError = { error?: string; code?: string | null };

class WorkbookRequestError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
  }
}

function uploadErrorPath(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  if ("pathname" in error && typeof error.pathname === "string") return error.pathname;
  if ("blob" in error) {
    const blob = error.blob;
    if (blob && typeof blob === "object" && "pathname" in blob && typeof blob.pathname === "string") {
      return blob.pathname;
    }
  }
  return null;
}

async function responseJson<T>(response: Response): Promise<T & ApiError> {
  try {
    return (await response.json()) as T & ApiError;
  } catch {
    return {} as T & ApiError;
  }
}

export default function ProjectWorkbookUpdateDialog({
  open,
  onOpenChange,
  projectId,
  currentUserId,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currentUserId: string;
  onUpdated: (result: WorkbookUpdateResult) => void;
}) {
  const t = useT();
  const { money } = useFormat();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetCandidate[] | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [sheetChoice, setSheetChoice] = useState("");
  const [recommendedSheetName, setRecommendedSheetName] = useState("");
  const [analysis, setAnalysis] = useState<WorkbookAnalysis | null>(null);
  const [sections, setSections] = useState<Sections>({
    projectDetails: false,
    boq: false,
    schedule: false,
    progress: false,
  });
  const [busy, setBusy] = useState<"discover" | "analyze" | "commit" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const baseUrl = `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/projects/${projectId}/workbook-update`;
  const selectedSheetName =
    sheetChoice === AUTO_SHEET ? recommendedSheetName : sheetChoice;
  const selectedSheet =
    sheets?.find((candidate) => candidate.sheetName === selectedSheetName) ?? null;
  const draftBlocked =
    (analysis?.summary.validationErrors.length ?? 0) > 0 ||
    analysis?.plan.weeklyProgress != null;
  const weeklyUpdateOnly = analysis?.plan.weeklyProgress != null;
  const progressAvailable = (analysis?.actualSnapshots.length ?? 0) > 0;
  const reviewRows = analysis?.rowPreview ?? [];
  const existingActualByPeriod = new Map(
    analysis?.existingActualSnapshots.map((snapshot) => [
      snapshot.periodIndex,
      snapshot.cumulativePercent,
    ]) ?? [],
  );
  const incomingActualByPeriod = new Map(
    analysis?.actualSnapshots.map((snapshot) => [snapshot.periodIndex, snapshot.cumulativePercent]) ?? [],
  );
  const actualReviewPeriods = [
    ...new Set([...existingActualByPeriod.keys(), ...incomingActualByPeriod.keys()]),
  ].sort((a, b) => a - b);
  const hasSelection = Object.values(sections).some(Boolean);
  const step = analysis ? 3 : sheets || pdfPageCount !== null ? 2 : 1;

  async function uploadAndProcess<T>(
    chosen: File,
    route: "discover" | "analyze" | "commit",
    body: Record<string, unknown>,
  ) {
    const kind = chosen.name.toLowerCase().endsWith(".pdf") ? "pdf" : "xlsx";
    const requestedPath = `temporary-workbooks/${projectId}/${currentUserId}/${crypto.randomUUID()}.${kind}`;
    let pathname: string;
    try {
      const blob = await uploadPrivateBlob({
        pathname: requestedPath,
        file: chosen,
        handleUploadUrl: `${baseUrl}/upload`,
        clientPayload: { projectId },
        contentType: kind === "pdf" ? PDF_CONTENT_TYPE : XLSX_CONTENT_TYPE,
      });
      pathname = blob.pathname;
    } catch (caught) {
      // Some upload failures happen after object creation. If the SDK exposes
      // that object's path, still send it through the one-use route so it can
      // be consumed and permanently deleted instead of being orphaned.
      const recoverablePath = uploadErrorPath(caught);
      if (!recoverablePath) throw caught;
      pathname = recoverablePath;
    }

    const response = await fetch(`${baseUrl}/${route}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pathname, filename: chosen.name, ...body }),
    });
    const result = await responseJson<T>(response);
    if (!response.ok) {
      throw new WorkbookRequestError(
        result.error ?? t.projectUpdate.requestFailed,
        result.code ?? null,
      );
    }
    return result;
  }

  async function discover(chosen: File) {
    setFile(chosen);
    setSheets(null);
    setPdfPageCount(null);
    setSheetChoice("");
    setRecommendedSheetName("");
    setAnalysis(null);
    setError(null);
    setBusy("discover");
    setStatus(t.projectUpdate.uploadingDiscover);
    try {
      const result = await uploadAndProcess<{
        kind?: "xlsx" | "pdf";
        sheets?: SheetCandidate[];
        recommendedSheetName?: string | null;
        pageCount?: number;
      }>(
        chosen,
        "discover",
        {},
      );
      if (result.kind === "pdf" && typeof result.pageCount === "number") {
        setPdfPageCount(result.pageCount);
        setStatus(t.projectUpdate.pdfReady);
        return;
      }
      if (!result.sheets?.length) throw new Error(t.projectUpdate.noSheets);
      setSheets(result.sheets);
      const recommended = result.recommendedSheetName ?? result.sheets[0]?.sheetName ?? "";
      setRecommendedSheetName(recommended);
      setSheetChoice(recommended ? AUTO_SHEET : "");
      setStatus(t.projectUpdate.discoveryReady);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectUpdate.requestFailed);
      setStatus(t.projectUpdate.discoveryFailed);
    } finally {
      setBusy(null);
    }
  }

  async function analyze() {
    if (!file || (pdfPageCount === null && !selectedSheetName)) return;
    setAnalysis(null);
    setSections({
      projectDetails: false,
      boq: false,
      schedule: false,
      progress: false,
    });
    setError(null);
    setBusy("analyze");
    setStatus(t.projectUpdate.uploadingAnalyze);
    try {
      const result = await uploadAndProcess<WorkbookAnalysis>(file, "analyze", {
        ...(selectedSheetName ? { selectedSheetName } : {}),
      });
      if (!result.plan || !result.summary || !result.actualSnapshots) {
        throw new Error(t.projectUpdate.analysisFailed);
      }
      const hasActuals = result.actualSnapshots.length > 0;
      setAnalysis(result);
      setSections({
        projectDetails: false,
        boq: false,
        schedule: false,
        progress: hasActuals,
      });
      setStatus(t.projectUpdate.analysisReady);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectUpdate.analysisFailed);
      setStatus(t.projectUpdate.analysisFailed);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!file || !analysis || !hasSelection) return;
    setError(null);
    setBusy("commit");
    setStatus(t.projectUpdate.uploadingCommit);
    try {
      const result = await uploadAndProcess<WorkbookUpdateResult>(file, "commit", {
        ...(selectedSheetName ? { selectedSheetName } : {}),
        plan: analysis.plan,
        sections,
        reviewState: analysis.reviewState,
      });
      if (!result.sectionsUpdated) throw new Error(t.projectUpdate.updateFailed);
      await Promise.all([
        queryClient.invalidateQueries(trpc.project.pathFilter()),
        queryClient.invalidateQueries(trpc.boq.pathFilter()),
        queryClient.invalidateQueries(trpc.schedule.pathFilter()),
        queryClient.invalidateQueries(trpc.progress.pathFilter()),
      ]);
      toast.success(t.projectUpdate.updateSucceeded);
      onOpenChange(false);
      onUpdated(result);
    } catch (caught) {
      const outdated =
        caught instanceof WorkbookRequestError &&
        (caught.code === "review_stale" || caught.code === "project_update_conflict");
      if (outdated) {
        setAnalysis(null);
        setSections({
          projectDetails: false,
          boq: false,
          schedule: false,
          progress: false,
        });
        setError(t.projectUpdate.analysisOutdated);
        setStatus(t.projectUpdate.analysisOutdated);
      } else {
        setError(caught instanceof Error ? caught.message : t.projectUpdate.updateFailed);
        setStatus(t.projectUpdate.updateFailed);
      }
    } finally {
      setBusy(null);
    }
  }

  function setDraftSelection(checked: boolean) {
    setSections((current) => ({ ...current, boq: checked, schedule: checked }));
  }

  const sheetItems = [
    ...(recommendedSheetName
      ? [
          {
            value: AUTO_SHEET,
            label: interpolate(t.projectUpdate.entireWorkbook, {
              sheet: recommendedSheetName,
            }),
          },
        ]
      : []),
    ...(sheets ?? []).map((candidate) => ({
      value: candidate.sheetName,
      label: interpolate(t.projectUpdate.sheetOption, {
        name: candidate.sheetName,
        state: t.projectUpdate.sheetStates[candidate.state],
        rows: candidate.rowCount,
        columns: candidate.columnCount,
      }),
    })),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(90svh,52rem)] overflow-y-auto sm:max-w-2xl"
        closeLabel={t.common.close}
      >
        <DialogHeader>
          <DialogTitle>{t.projectUpdate.title}</DialogTitle>
          <DialogDescription>{t.projectUpdate.description}</DialogDescription>
        </DialogHeader>

        <p className="font-medium text-muted-foreground">
          {interpolate(t.projectUpdate.step, { current: step, total: 3 })}
        </p>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <section className="space-y-2" aria-labelledby="workbook-update-file-title">
            <h3 id="workbook-update-file-title" className="font-medium">
              {t.projectUpdate.stepFile}
            </h3>
            <Label htmlFor="workbook-update-file">{t.projectUpdate.chooseFile}</Label>
            <Input
              id="workbook-update-file"
              type="file"
              accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy !== null}
              aria-describedby="workbook-update-file-hint"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (!chosen) return;
                setFile(null);
                setSheets(null);
                setPdfPageCount(null);
                setSheetChoice("");
                setRecommendedSheetName("");
                setAnalysis(null);
                setSections({
                  projectDetails: false,
                  boq: false,
                  schedule: false,
                  progress: false,
                });
                setError(null);
                setStatus("");
                const kind = chosen.name.toLowerCase().endsWith(".pdf")
                  ? "pdf"
                  : chosen.name.toLowerCase().endsWith(".xlsx")
                    ? "xlsx"
                    : null;
                if (!kind) {
                  setError(t.projectUpdate.fileTypeError);
                  setStatus(t.projectUpdate.discoveryFailed);
                  event.target.value = "";
                  return;
                }
                if (chosen.size > (kind === "pdf" ? MAX_AI_PDF_BYTES : MAX_AI_WORKBOOK_BYTES)) {
                  setError(t.projectUpdate.fileSizeError);
                  setStatus(t.projectUpdate.discoveryFailed);
                  event.target.value = "";
                  return;
                }
                void discover(chosen);
              }}
            />
            <p id="workbook-update-file-hint" className="text-muted-foreground">
              {t.projectUpdate.fileHint}
            </p>
            {file && <p className="text-muted-foreground">{file.name}</p>}
            {file && !sheets && error && busy === null && (
              <Button type="button" variant="outline" size="sm" onClick={() => void discover(file)}>
                {t.projectUpdate.retryDiscovery}
              </Button>
            )}
          </section>

          {sheets && (
            <section className="space-y-3 border-t pt-4" aria-labelledby="workbook-update-sheet-title">
              <div>
                <h3 id="workbook-update-sheet-title" className="font-medium">
                  {t.projectUpdate.stepSheet}
                </h3>
                <p className="text-muted-foreground">{t.projectUpdate.sheetHint}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workbook-update-sheet">{t.projectUpdate.sheetLabel}</Label>
                <Select
                  items={sheetItems}
                  value={sheetChoice}
                  disabled={busy !== null}
                  onValueChange={(value) => {
                    setSheetChoice(value ?? "");
                    setAnalysis(null);
                    setSections({
                      projectDetails: false,
                      boq: false,
                      schedule: false,
                      progress: false,
                    });
                    setError(null);
                    setStatus(t.projectUpdate.discoveryReady);
                  }}
                >
                  <SelectTrigger id="workbook-update-sheet" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {recommendedSheetName && (
                      <SelectItem value={AUTO_SHEET}>
                        {interpolate(t.projectUpdate.entireWorkbook, {
                          sheet: recommendedSheetName,
                        })}
                      </SelectItem>
                    )}
                    {sheets.map((candidate) => (
                      <SelectItem key={candidate.sheetName} value={candidate.sheetName}>
                        {interpolate(t.projectUpdate.sheetOption, {
                          name: candidate.sheetName,
                          state: t.projectUpdate.sheetStates[candidate.state],
                          rows: candidate.rowCount,
                          columns: candidate.columnCount,
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedSheet && (
                <div className="rounded-lg border p-3">
                  <p className="font-medium">
                    {selectedSheet.knownSCurve
                      ? t.projectUpdate.knownSCurve
                      : t.projectUpdate.otherLayout}
                  </p>
                  <p className="text-muted-foreground">
                    {selectedSheet.actualSnapshotCount > 0 &&
                    selectedSheet.latestActualPercent !== null
                      ? interpolate(t.projectUpdate.sheetActuals, {
                          count: selectedSheet.actualSnapshotCount,
                          percent: selectedSheet.latestActualPercent.toFixed(2),
                          period: selectedSheet.latestActualPeriodIndex ?? "-",
                        })
                      : t.projectUpdate.noSheetActuals}
                  </p>
                  {selectedSheet.warnings.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 ps-4 text-muted-foreground">
                      {selectedSheet.warnings.map((warning, index) => (
                        <li key={`${warning.row}-${warning.column}-${index}`}>{warning.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                  disabled={busy !== null || !selectedSheetName || analysis !== null}
                onClick={() => void analyze()}
              >
                {busy === "analyze" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t.projectUpdate.analyzeAction}
              </Button>
            </section>
          )}

          {pdfPageCount !== null && !analysis && (
            <section className="space-y-3 border-t pt-4" aria-labelledby="project-update-pdf-title">
              <div>
                <h3 id="project-update-pdf-title" className="font-medium">
                  {t.projectUpdate.stepSource}
                </h3>
                <p className="text-muted-foreground">
                  {interpolate(t.projectImport.pdfPages, { count: pdfPageCount })}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void analyze()}
              >
                {busy === "analyze" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t.projectImport.analyzePdfAction}
              </Button>
            </section>
          )}

          {analysis && (
            <section className="space-y-4 border-t pt-4" aria-labelledby="workbook-update-sections-title">
              <div>
                <h3 id="workbook-update-sections-title" className="font-medium">
                  {t.projectUpdate.stepSections}
                </h3>
                <p className="text-muted-foreground">{t.projectUpdate.sectionsHint}</p>
              </div>

              <dl className="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">{t.projectUpdate.summaryLines}</dt>
                  <dd className="font-medium tabular-nums">{analysis.summary.lineCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.projectUpdate.summarySections}</dt>
                  <dd className="font-medium tabular-nums">{analysis.summary.sectionCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.projectUpdate.summaryPeriods}</dt>
                  <dd className="font-medium tabular-nums">{analysis.plan.periodCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t.projectUpdate.summaryActuals}</dt>
                  <dd className="font-medium tabular-nums">
                    {analysis.actualSnapshots.length}
                    {analysis.summary.latestActualPercent !== null
                      ? ` · ${analysis.summary.latestActualPercent.toFixed(2)}%`
                      : ""}
                  </dd>
                </div>
              </dl>

              <div className="space-y-2 rounded-lg border p-3">
                <h4 className="font-medium">{t.projectImport.rowReviewTitle}</h4>
                <div
                  className="max-h-64 overflow-auto rounded-md border"
                  role="region"
                  aria-label={t.projectImport.rowReviewTitle}
                  tabIndex={0}
                >
                  <table className="w-full min-w-[60rem] text-left text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th scope="col" className="px-2 py-2 font-medium">#</th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.pdfSource}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.rowKind}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.mappingFields.description}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.mappingFields.quantity}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.mappingFields.unitRate}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.mappingFields.amount}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.mappingFields.weight}
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          {t.projectImport.periods}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewRows.map((row) => (
                          <tr key={row.row} className="border-t align-top">
                            <td className="px-2 py-2 tabular-nums text-muted-foreground">
                              {row.sourcePage
                                ? `p${row.sourcePage}:${row.sourceRow ?? row.row}`
                                : row.sourceSheet
                                  ? `${row.sourceSheet}:${row.sourceRow ?? row.row}`
                                  : row.row}
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">
                              {row.sourcePage
                                ? `p${row.sourcePage}:${row.sourceRow} · ${row.sourceTable}`
                                : row.sourceSheet
                                  ? `${row.sourceSheet}:${row.sourceRow ?? row.row}`
                                  : "-"}
                            </td>
                            <td className="px-2 py-2">{t.projectImport.rowKinds[row.kind]}</td>
                            <td className="max-w-72 px-2 py-2">
                              <span className="font-medium">{row.code ? `${row.code} · ` : ""}</span>
                              {row.description}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {row.quantity ?? "-"} {row.unit ?? ""}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {row.unitRate === null ? "-" : money(row.unitRate)}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {row.amount === null ? "-" : money(row.amount)}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {row.weight === null ? "-" : `${row.weight.toFixed(4)}%`}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {row.startPeriodIndex === null || row.finishPeriodIndex === null
                                ? "-"
                                : `${row.startPeriodIndex}-${row.finishPeriodIndex}`}
                            </td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {actualReviewPeriods.length > 0 && (
                <div className="space-y-2 rounded-lg border p-3">
                  <h4 className="font-medium">{t.projectUpdate.sectionProgress}</h4>
                  <div
                    className="max-h-40 overflow-auto rounded-md border"
                    role="region"
                    aria-label={t.projectUpdate.sectionProgress}
                    tabIndex={0}
                  >
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {t.projectImport.periods}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {t.projectUpdate.currentValue}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {t.projectUpdate.incomingValue}
                          </th>
                          <th scope="col" className="px-2 py-2 font-medium">
                            {t.projectUpdate.storedResultValue}
                          </th>
                          {analysis.plan.profile === "pdf-ai" && (
                            <th scope="col" className="px-2 py-2 font-medium">
                              {t.projectImport.pdfSource}
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {actualReviewPeriods.map((periodIndex) => {
                          const current = existingActualByPeriod.get(periodIndex);
                          const incoming = incomingActualByPeriod.get(periodIndex);
                          const result = incoming ?? current;
                          return (
                            <tr key={periodIndex} className="border-t">
                              <td className="px-2 py-2 tabular-nums">{periodIndex}</td>
                              <td className="px-2 py-2 tabular-nums">
                                {current === undefined ? "-" : `${current.toFixed(4)}%`}
                              </td>
                              <td className="px-2 py-2 tabular-nums">
                                {incoming === undefined ? "-" : `${incoming.toFixed(4)}%`}
                              </td>
                              <td className="px-2 py-2 tabular-nums">
                                {result === undefined ? "-" : `${result.toFixed(4)}%`}
                              </td>
                              {analysis.plan.profile === "pdf-ai" && (
                                <td className="px-2 py-2">
                                  {analysis.actualSnapshots.find(
                                    (snapshot) => snapshot.periodIndex === periodIndex,
                                  )?.sourceLabel ?? "-"}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {analysis.plan.profile === "pdf-ai" &&
                (analysis.pdfActualPreview?.length ?? 0) > 0 && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <h4 className="font-medium">{t.projectImport.pdfExtractedActuals}</h4>
                    <div
                      className="max-h-48 overflow-auto rounded-md border"
                      role="region"
                      aria-label={t.projectImport.pdfExtractedActuals}
                      tabIndex={0}
                    >
                      <table className="w-full text-left text-xs">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.pdfSource}</th>
                            <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.periods}</th>
                            <th scope="col" className="px-2 py-2 font-medium">%</th>
                            <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.sourceValue}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analysis.pdfActualPreview?.map((snapshot, index) => (
                            <tr key={`${snapshot.periodIndex}-${snapshot.sourceRow}-${index}`} className="border-t">
                              <td className="px-2 py-2">{`p${snapshot.page}:${snapshot.sourceRow} · ${snapshot.table}`}</td>
                              <td className="px-2 py-2 tabular-nums">{snapshot.periodIndex}</td>
                              <td className="px-2 py-2 tabular-nums">{snapshot.cumulativePercent.toFixed(4)}%</td>
                              <td className="px-2 py-2">{snapshot.sourceValue}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

              <div className="space-y-3">
                <div className="grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1 rounded-lg border p-3">
                  <Checkbox
                    id="workbook-update-project-details"
                    checked={sections.projectDetails}
                    disabled={busy !== null || weeklyUpdateOnly}
                    aria-describedby="workbook-update-project-details-hint"
                    onCheckedChange={(checked) =>
                      setSections((current) => ({ ...current, projectDetails: checked === true }))
                    }
                  />
                  <Label htmlFor="workbook-update-project-details">
                    {t.projectUpdate.sectionProjectDetails}
                  </Label>
                  <p
                    id="workbook-update-project-details-hint"
                    className="col-start-2 text-muted-foreground"
                  >
                    {weeklyUpdateOnly
                      ? t.projectUpdate.weeklyCreateOnlyHint
                      : t.projectUpdate.sectionProjectDetailsHint}
                  </p>
                  {sections.projectDetails && (
                    <dl className="col-start-2 mt-2 grid gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
                      {(
                        [
                          [
                            t.projects.code,
                            analysis.currentProject.code,
                            analysis.plan.suggestedCode,
                            (analysis.plan.suggestedCode ?? analysis.currentProject.code).toUpperCase(),
                          ],
                          [
                            t.projects.name,
                            analysis.currentProject.name,
                            analysis.plan.suggestedName,
                            analysis.plan.suggestedName ?? analysis.currentProject.name,
                          ],
                          [
                            t.projects.client,
                            analysis.currentProject.client,
                            analysis.plan.suggestedClient,
                            analysis.plan.suggestedClient ?? analysis.currentProject.client,
                          ],
                          [
                            t.projects.location,
                            analysis.currentProject.location,
                            analysis.plan.suggestedLocation,
                            analysis.plan.suggestedLocation ?? analysis.currentProject.location,
                          ],
                        ] as const
                      ).map(([label, before, incoming, result]) => (
                        <div key={label} className="min-w-0">
                          <dt className="text-xs text-muted-foreground">{label}</dt>
                          <dd className="mt-1 grid grid-cols-3 gap-2 text-xs">
                            <span className="truncate" title={before ?? undefined}>
                              <span className="block text-muted-foreground">
                                {t.projectUpdate.currentValue}
                              </span>
                              {before ?? "-"}
                            </span>
                            <span className="truncate" title={incoming ?? undefined}>
                              <span className="block text-muted-foreground">
                                {t.projectUpdate.incomingValue}
                              </span>
                              {incoming ?? "-"}
                            </span>
                            <span className="truncate font-medium" title={result ?? undefined}>
                              <span className="block text-muted-foreground">
                                {t.projectUpdate.resultValue}
                              </span>
                              {result ?? "-"}
                            </span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border p-3">
                  <div className="grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1">
                    <Checkbox
                      id="workbook-update-boq"
                      checked={sections.boq}
                      disabled={busy !== null || draftBlocked}
                      aria-describedby="workbook-update-boq-hint workbook-update-draft-hint"
                      onCheckedChange={(checked) => setDraftSelection(checked === true)}
                    />
                    <Label htmlFor="workbook-update-boq">{t.projectUpdate.sectionBoq}</Label>
                    <p id="workbook-update-boq-hint" className="col-start-2 text-muted-foreground">
                      {t.projectUpdate.sectionBoqHint}
                    </p>
                  </div>
                  <div className="grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1">
                    <Checkbox
                      id="workbook-update-schedule"
                      checked={sections.schedule}
                      disabled={busy !== null || draftBlocked}
                      aria-describedby="workbook-update-schedule-hint workbook-update-draft-hint"
                      onCheckedChange={(checked) => setDraftSelection(checked === true)}
                    />
                    <Label htmlFor="workbook-update-schedule">
                      {t.projectUpdate.sectionSchedule}
                    </Label>
                    <p
                      id="workbook-update-schedule-hint"
                      className="col-start-2 text-muted-foreground"
                    >
                      {t.projectUpdate.sectionScheduleHint}
                    </p>
                  </div>
                  <p id="workbook-update-draft-hint" className="text-muted-foreground">
                    {draftBlocked
                      ? analysis.plan.weeklyProgress
                        ? t.projectUpdate.weeklyCreateOnlyHint
                        : t.projectUpdate.draftBlockedHint
                      : t.projectUpdate.draftCoupledHint}
                  </p>
                </div>

                <div className="grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1 rounded-lg border p-3">
                  <Checkbox
                    id="workbook-update-progress"
                    checked={sections.progress}
                    disabled={busy !== null || !progressAvailable}
                    aria-describedby="workbook-update-progress-hint"
                    onCheckedChange={(checked) =>
                      setSections((current) => ({ ...current, progress: checked === true }))
                    }
                  />
                  <Label htmlFor="workbook-update-progress">
                    {t.projectUpdate.sectionProgress}
                  </Label>
                  <p id="workbook-update-progress-hint" className="col-start-2 text-muted-foreground">
                    {progressAvailable
                      ? t.projectUpdate.sectionProgressHint
                      : t.projectUpdate.progressUnavailableHint}
                  </p>
                </div>
              </div>

              {analysis.plan.warnings.length > 0 && (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>{t.projectUpdate.warningsTitle}</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 ps-4">
                      {analysis.plan.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}

              {analysis.summary.validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>{t.projectUpdate.validationTitle}</AlertTitle>
                  <AlertDescription>
                    <p>{t.projectUpdate.validationHint}</p>
                    <ul className="mt-2 list-disc space-y-1 ps-4">
                      {analysis.summary.validationErrors.map((item, index) => (
                        <li key={`${item.row}-${item.column}-${index}`}>
                          {interpolate(t.projectUpdate.validationError, {
                            row: item.row,
                            message: item.message,
                          })}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
            </section>
          )}

          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t.projectUpdate.errorTitle}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <p role="status" aria-live="polite" className="min-h-5 text-muted-foreground">
            {busy && <Loader2 className="me-2 inline animate-spin motion-reduce:animate-none" />}
            {status}
          </p>
        </div>

        {analysis && (
          <DialogFooter>
            {!hasSelection && <p className="me-auto text-destructive">{t.projectUpdate.selectOne}</p>}
            <Button type="button" disabled={busy !== null || !hasSelection} onClick={() => void commit()}>
              {busy === "commit" && <Loader2 className="animate-spin motion-reduce:animate-none" />}
              {t.projectUpdate.updateAction}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
