"use client";

import { env } from "@DashboardV2/env/web";
import { endDateForPeriodCount, generatePeriods } from "@DashboardV2/api/lib/periods";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@DashboardV2/ui/components/dialog";
import { TRIAL_AI_EXHAUSTED } from "@DashboardV2/api/lib/trial";
import { Input } from "@DashboardV2/ui/components/input";
import { Label } from "@DashboardV2/ui/components/label";
import { Clock, Loader2, Lock, TriangleAlert, Upload, X } from "@DashboardV2/ui/components/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { StepRunner } from "@/components/step-runner";
import {
  CUSTOM_PERIOD_MAX_DAYS,
  CUSTOM_PERIOD_MIN_DAYS,
} from "@DashboardV2/api/lib/periods";
import { PERIOD_TYPES, type PeriodType } from "@DashboardV2/db/schema";

import { interpolate, plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { uploadPrivateBlob } from "@/lib/client-blob-upload";
import { getServerUrl } from "@/lib/server-url";
import {
  getWorkbookScheduleIssue,
  type ScheduleIssue,
} from "@/lib/project-workbook-schedule";
import { useDebounced } from "@/lib/use-debounced";
import { cadenceLabel } from "@/lib/cadence";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

type MappingField =
  | "description"
  | "unit"
  | "quantity"
  | "unitRate"
  | "amount"
  | "weight"
  | "start"
  | "finish";
type Plan = {
  version: 2;
  fileHash: string;
  analysisSignature: string;
  profile: "reference-s-curve" | "generic-ai" | "generic-deterministic" | "pdf-ai";
  sheetName: string;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
  sectionRows: number[];
  excludedRows: number[];
  mandatoryExcludedRows: number[];
  userExcludedRows: number[];
  parentAssignments: { row: number; parentRow: number | null }[];
  actualCurve: {
    sourceRow: number;
    periodColumns: { periodIndex: number; column: number }[];
  } | null;
  mapping: { fields: Record<MappingField, number | undefined> };
  suggestedCode: string | null;
  suggestedName: string | null;
  suggestedClient: string | null;
  suggestedLocation: string | null;
  suggestedStartDate: string | null;
  suggestedScheduleStartDate: string | null;
  suggestedEndDate: string | null;
  periodType: PeriodType;
  periodLengthDays: number | null;
  periodCount: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  weeklyProgress?: {
    version: 1;
    detailSheetCount: number;
    categoryCount: number;
    previousPeriodIndex: number;
    currentPeriodIndex: number;
  } | null;
};
type Analysis = {
  plan: Plan;
  columns: { index: number; letter: string; header: string; samples: string[] }[];
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
  weeklyProgressPreview?: {
    detailSheetCount: number;
    categoryCount: number;
    previousPeriodIndex: number;
    currentPeriodIndex: number;
    previousEntryCount: number;
    currentEntryCount: number;
    itemizedPreviousPercent: number;
    itemizedCurrentPercent: number;
    aggregatePreviousPercent: number | null;
    aggregateCurrentPercent: number;
    confirmationRequired: boolean;
  };
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
  summary: {
    sectionCount: number;
    lineCount: number;
    scheduledCount: number;
    totalAmount: number;
    totalWeight: number;
    actualSnapshotCount: number;
    latestActualPercent: number | null;
    latestActualPeriodIndex: number | null;
    validationErrors: { row: number; column: string | null; message: string }[];
  };
};
type SheetCandidate = {
  sheetName: string;
  state: "visible" | "hidden" | "veryHidden";
  rowCount: number;
  columnCount: number;
  knownSCurve: boolean;
  warnings: { row: number; column: string | null; message: string }[];
  actualSnapshotCount: number;
  latestActualPeriodIndex: number | null;
  latestActualPercent: number | null;
};
type Answers = {
  name: string;
  code: string;
  client: string;
  location: string;
  startDate: string;
  scheduleStart: string;
  endDate: string;
  periodType: PeriodType;
  /** A string because an empty field is a state someone types through. */
  periodLengthDays: string;
};

const EMPTY: Answers = {
  name: "",
  code: "",
  client: "",
  location: "",
  startDate: "",
  scheduleStart: "",
  endDate: "",
  periodType: "weekly",
  periodLengthDays: "",
};
/**
 * The cycle length an answer set implies, or null when it does not need one.
 *
 * Returns null for a custom cadence whose length is missing or out of range
 * too — the period helpers throw on that, and every caller here is already
 * inside a try or is choosing not to compute.
 */
function cycleLength(answers: Answers): number | null {
  if (answers.periodType !== "custom") return null;
  const days = Number(answers.periodLengthDays);
  return Number.isInteger(days) &&
    days >= CUSTOM_PERIOD_MIN_DAYS &&
    days <= CUSTOM_PERIOD_MAX_DAYS
    ? days
    : null;
}

/** Whether the cadence half of the answers is complete enough to submit. */
function cadenceReady(answers: Answers): boolean {
  return answers.periodType !== "custom" || cycleLength(answers) !== null;
}

function scheduleAnswers(answers: Answers) {
  return {
    startDate: answers.startDate,
    scheduleStart: answers.scheduleStart,
    endDate: answers.endDate,
    periodType: answers.periodType,
    periodLengthDays: cycleLength(answers),
  };
}

const QUESTIONS = [
  "name",
  "code",
  "client",
  "location",
  "periodType",
  "startDate",
  "scheduleStart",
  "endDate",
] as const;
type Question = (typeof QUESTIONS)[number];
type CalendarDifference = "startDate" | "scheduleStart" | "endDate" | "periodType";

function isCalendarDifference(value: unknown): value is CalendarDifference {
  return (
    value === "startDate" ||
    value === "scheduleStart" ||
    value === "endDate" ||
    value === "periodType"
  );
}

const CODE_QUESTION_INDEX = QUESTIONS.indexOf("code");
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF_CONTENT_TYPE = "application/pdf";
// A colon is forbidden in Excel worksheet names, so this cannot collide with a real sheet.
const AUTO_SHEET = ":entire-workbook";

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function importFileKind(file: File) {
  if (file.name.toLowerCase().endsWith(".pdf")) return "pdf" as const;
  if (file.name.toLowerCase().endsWith(".xlsx")) return "xlsx" as const;
  return null;
}

function reportingPeriodPreview(answers: Answers) {
  if (!answers.scheduleStart || !answers.endDate || !cadenceReady(answers)) return [];
  try {
    return generatePeriods(
      answers.scheduleStart,
      answers.endDate,
      answers.periodType,
      cycleLength(answers),
    );
  } catch {
    return [];
  }
}

async function uploadWorkbook(
  file: File,
  currentUserId: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  const kind = importFileKind(file);
  if (!kind) throw new Error("Unsupported project import file.");
  const blob = await uploadPrivateBlob({
    pathname: `temporary-workbooks/project-import/${currentUserId}/${crypto.randomUUID()}.${kind}`,
    file,
    handleUploadUrl: `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/upload`,
    contentType: kind === "pdf" ? PDF_CONTENT_TYPE : XLSX_CONTENT_TYPE,
  });
  return JSON.stringify({ pathname: blob.pathname, filename: file.name, ...metadata });
}

/** Mirrors NDJSON_CONTENT_TYPE in apps/server/src/index.ts. */
const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** The stages the server reports, in the order it reports them. */
const SERVER_STAGES = ["reading", "recognising", "parsing", "interpreting", "building"] as const;
type ServerStage = (typeof SERVER_STAGES)[number];

/** The two the browser can time itself: preparing the upload, then sending it. */
const CLIENT_STAGES = ["preparing", "uploading"] as const;
const CLIENT_STAGE_COUNT = CLIENT_STAGES.length;
const ALL_STAGES = [...CLIENT_STAGES, ...SERVER_STAGES] as const;

type AnalysisBody = Analysis & {
  error?: string;
  code?: string;
  status?: number;
  trialAiCreditsLeft?: number;
};

/**
 * Reads the analysis, streamed or not.
 *
 * The route answers with NDJSON when asked and a single JSON body otherwise,
 * and a proxy that buffers the stream turns the first into the second without
 * telling anyone. So the shape is decided by what actually arrived rather than
 * by what was requested: anything that is not NDJSON is read as one body, and
 * the run simply shows no intermediate steps.
 */
async function readAnalysis(
  response: Response,
  { onStage }: { onStage: (stage: ServerStage) => void },
): Promise<AnalysisBody | null> {
  const streamed = response.headers.get("content-type")?.includes(NDJSON_CONTENT_TYPE);
  if (!streamed || !response.body) return readJson<AnalysisBody>(response);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = "";
  let last: AnalysisBody | null = null;

  const consume = (line: string) => {
    if (!line.trim()) return;
    let payload: { stage?: string; done?: boolean; result?: AnalysisBody } & AnalysisBody;
    try {
      payload = JSON.parse(line);
    } catch {
      return;
    }
    if (payload.stage) {
      onStage(payload.stage as ServerStage);
      return;
    }
    // The last line is the outcome: either the analysis or the error that
    // replaced it. A status cannot be sent once the body has started.
    last = payload.done ? (payload.result ?? null) : payload;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  consume(buffered);

  return last;
}

export default function ProjectWorkbookImportDialog({
  open,
  onOpenChange,
  onCreated,
  currentUserId,
  trialAiCredits,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string) => void;
  currentUserId: string;
  /** AI imports this trial has left; null on an account with no trial. */
  trialAiCredits: number | null;
}) {
  const t = useT();
  const { money } = useFormat();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetCandidate[] | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [sheetChoice, setSheetChoice] = useState("");
  const [recommendedSheetName, setRecommendedSheetName] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [reviewStale, setReviewStale] = useState(false);
  const [acceptProgressDifference, setAcceptProgressDifference] = useState(false);
  const [endDateInferred, setEndDateInferred] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Set when the server refuses because a trial has spent its AI allowance. */
  const [aiExhausted, setAiExhausted] = useState(false);
  /**
   * What the last analyze reported. Null until one does, at which point it
   * supersedes the figure this page was rendered with — the session prop was
   * read once, and an import spends a credit after that.
   */
  const [creditsLeft, setCreditsLeft] = useState<number | null>(null);
  const remainingCredits = creditsLeft ?? trialAiCredits;
  /** Steps completed, indexing into ALL_STAGES. */
  const [stagesDone, setStagesDone] = useState(0);
  /** Stages the run legitimately never entered — counted in the total, never drawn. */
  const [skippedStages, setSkippedStages] = useState<readonly ServerStage[]>([]);
  /** Which server stages actually arrived, so a skip can be told from a gap. */
  const seenStages = useRef(new Set<ServerStage>());
  const progressConfirmationRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeConflict, setCodeConflict] = useState<string | null>(null);
  const [serverScheduleIssue, setServerScheduleIssue] = useState<ScheduleIssue | null>(null);
  const [rowErrors, setRowErrors] = useState<Analysis["summary"]["validationErrors"]>([]);
  const question = QUESTIONS[questionIndex]!;
  const canonicalCode = answers.code.trim().toUpperCase();
  const debouncedCode = useDebounced(canonicalCode);
  const codeSyntaxValid = /^[A-Z0-9-]+$/.test(canonicalCode) && canonicalCode.length <= 32;
  const codeAvailability = useQuery({
    ...trpc.project.codeAvailability.queryOptions({ code: debouncedCode }),
    enabled:
      open &&
      Boolean(analysis) &&
      !reviewing &&
      question === "code" &&
      codeSyntaxValid &&
      debouncedCode === canonicalCode,
    retry: false,
  });
  const codeTaken =
    codeConflict === canonicalCode ||
    (debouncedCode === canonicalCode && codeAvailability.data?.available === false);
  const codeCheckPending =
    question === "code" &&
    codeSyntaxValid &&
    (debouncedCode !== canonicalCode || codeAvailability.isFetching);
  const codeCheckFailed =
    question === "code" &&
    debouncedCode === canonicalCode &&
    codeAvailability.isError;

  function reset() {
    setFile(null);
    setSheets(null);
    setPdfPageCount(null);
    setSheetChoice("");
    setRecommendedSheetName("");
    setDiscovering(false);
    setAnalysis(null);
    setAnswers(EMPTY);
    setQuestionIndex(0);
    setReviewing(false);
    setReviewStale(false);
    setAcceptProgressDifference(false);
    setEndDateInferred(false);
    setBusy(false);
    setError(null);
    setAiExhausted(false);
    // Deliberately not cleared: the count belongs to the account, not to this
    // run. Resetting it fell back to the prop the page was rendered with, so
    // closing and reopening the dialog after an import showed the pre-spend
    // figure and promised a credit that was already gone.
    setStagesDone(0);
    setSkippedStages([]);
    seenStages.current.clear();
    setCodeConflict(null);
    setServerScheduleIssue(null);
    setRowErrors([]);
  }

  async function discover(chosen: File) {
    const kind = importFileKind(chosen);
    if (!kind) {
      setError(t.projectImport.fileTypeError);
      return;
    }
    if (chosen.size > (kind === "pdf" ? MAX_AI_PDF_BYTES : MAX_AI_WORKBOOK_BYTES)) {
      setError(t.projectImport.fileSizeError);
      return;
    }
    setFile(chosen);
    setSheets(null);
    setPdfPageCount(null);
    setSheetChoice("");
    setRecommendedSheetName("");
    setError(null);
    setAiExhausted(false);
    setDiscovering(true);
    try {
      const data = await uploadWorkbook(chosen, currentUserId);
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/discover`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: data,
        },
      );
      const body = await readJson<{
        kind?: "xlsx" | "pdf";
        sheets?: SheetCandidate[];
        recommendedSheetName?: string | null;
        pageCount?: number;
        error?: string;
      }>(response);
      if (!response.ok || !body) {
        throw new Error(body?.error ?? t.projectUpdate.discoveryFailed);
      }
      if (body.kind === "pdf" && typeof body.pageCount === "number") {
        setPdfPageCount(body.pageCount);
        return;
      }
      if (!body.sheets) throw new Error(body.error ?? t.projectUpdate.discoveryFailed);
      setSheets(body.sheets);
      const recommended = body.recommendedSheetName ?? body.sheets[0]?.sheetName ?? "";
      setRecommendedSheetName(recommended);
      setSheetChoice(recommended ? AUTO_SHEET : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectUpdate.discoveryFailed);
    } finally {
      setDiscovering(false);
    }
  }

  async function analyze(chosen: File, sheetName?: string) {
    setBusy(true);
    setError(null);
    setAiExhausted(false);
    setStagesDone(0);
    setSkippedStages([]);
    seenStages.current.clear();
    try {
      setStagesDone(1);
      const data = await uploadWorkbook(chosen, currentUserId, {
        ...(sheetName ? { selectedSheetName: sheetName } : {}),
      });
      setStagesDone(2);
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/analyze`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            // Asks for stage-by-stage progress. The route still answers with a
            // single JSON body without this, which is what readAnalysis falls
            // back to when a proxy buffers the stream away.
            Accept: NDJSON_CONTENT_TYPE,
          },
          body: data,
        },
      );
      const body = await readAnalysis(response, {
        onStage: (stage) => {
          const index = SERVER_STAGES.indexOf(stage);
          if (index === -1) return;
          setStagesDone(CLIENT_STAGE_COUNT + index);
          // Reaching `building` without `interpreting` means the workbook was
          // recognised outright and the model was never called for it.
          if (stage === "building" && !seenStages.current.has("interpreting")) {
            setSkippedStages(["parsing", "interpreting"]);
          } else if (stage === "interpreting" && !seenStages.current.has("parsing")) {
            setSkippedStages(["parsing"]);
          }
          seenStages.current.add(stage);
        },
      });
      // A used-up trial allowance is not a failure of the workbook — the file
      // was never read. Say so, and leave the manual import as the way through.
      if (body?.code === TRIAL_AI_EXHAUSTED) {
        setAiExhausted(true);
        return;
      }
      if (!response.ok || !body?.plan) throw new Error(body?.error ?? t.projectImport.analyzeFailed);
      setAnalysis(body);
      setAcceptProgressDifference(false);
      setServerScheduleIssue(null);
      setAnswers({
        ...EMPTY,
        code: body.plan.suggestedCode ?? "",
        name: body.plan.suggestedName ?? "",
        client: body.plan.suggestedClient ?? "",
        location: body.plan.suggestedLocation ?? "",
        startDate: body.plan.suggestedStartDate ?? "",
        scheduleStart:
          body.plan.suggestedScheduleStartDate ?? body.plan.suggestedStartDate ?? "",
        endDate: body.plan.suggestedEndDate ?? "",
        periodType: body.plan.periodType,
        periodLengthDays:
          body.plan.periodLengthDays === null ? "" : String(body.plan.periodLengthDays),
      });
      setQuestionIndex(0);
      setEndDateInferred(false);
      setCreditsLeft(body.trialAiCreditsLeft ?? null);
      setStagesDone(ALL_STAGES.length);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectImport.analyzeFailed);
    } finally {
      setBusy(false);
    }
  }

  function questionError(question: Question) {
    const value = answers[question];
    if (question === "name" && !value.trim()) return t.projects.nameRequired;
    if (question === "code") {
      if (!value.trim()) return t.projects.codeRequired;
      if (!/^[A-Za-z0-9-]+$/.test(value)) return t.projects.codeFormat;
    }
    if (question === "startDate" && !value) return t.projectImport.startRequired;
    if (question === "scheduleStart") {
      if (!value) return t.projectImport.scheduleStartRequired;
      if (answers.startDate && value < answers.startDate) {
        return t.projectImport.scheduleBeforeStart;
      }
    }
    if (question === "endDate") {
      if (!value) return t.projectImport.endRequired;
      if (
        (answers.startDate && value < answers.startDate) ||
        (answers.scheduleStart && value < answers.scheduleStart)
      ) {
        return t.projects.endBeforeStart;
      }
    }
    return null;
  }

  async function nextQuestion() {
    const problem = questionError(question);
    if (problem) {
      setError(problem);
      return;
    }
    if (question === "code") {
      setBusy(true);
      try {
        const availability = await queryClient.fetchQuery({
          ...trpc.project.codeAvailability.queryOptions({ code: canonicalCode }),
          retry: false,
          staleTime: 0,
        });
        if (!availability.available) {
          setCodeConflict(canonicalCode);
          setError(null);
          return;
        }
        setCodeConflict(null);
      } catch {
        setError(t.projectImport.codeCheckFailed);
        return;
      } finally {
        setBusy(false);
      }
    }
    setError(null);
    if (
      question === "scheduleStart" &&
      analysis &&
      analysis.plan.periodCount > 0 &&
      (!answers.endDate || endDateInferred)
    ) {
      setEndDateInferred(true);
      setAnswers((current) => ({
        ...current,
        endDate: endDateForPeriodCount(
          current.scheduleStart,
          analysis.plan.periodCount,
          current.periodType,
          cycleLength(current),
        ),
      }));
    }
    if (questionIndex === QUESTIONS.length - 1) setReviewing(true);
    else setQuestionIndex((current) => current + 1);
  }

  function updateMapping(field: MappingField, value: string) {
    setReviewStale(true);
    setAnalysis((current) => {
      if (!current) return current;
      const fields = { ...current.plan.mapping.fields };
      if (value) fields[field] = Number(value);
      else delete fields[field];
      return { ...current, plan: { ...current.plan, mapping: { fields } } };
    });
  }

  function updateRowKind(row: number, kind: "item" | "section") {
    setReviewStale(true);
    setAnalysis((current) => {
      if (!current) return current;
      const sectionRows = current.plan.sectionRows.filter((candidate) => candidate !== row);
      const excludedRows = current.plan.excludedRows.filter((candidate) => candidate !== row);
      const userExcludedRows = current.plan.userExcludedRows.filter(
        (candidate) => candidate !== row,
      );
      const parentAssignments = current.plan.parentAssignments
        .filter((assignment) => assignment.row !== row)
        .map((assignment) =>
          assignment.parentRow === row ? { ...assignment, parentRow: null } : assignment,
        );
      if (kind === "section") sectionRows.push(row);
      if (kind === "item") parentAssignments.push({ row, parentRow: null });
      return {
        ...current,
        plan: {
          ...current.plan,
          sectionRows: sectionRows.sort((a, b) => a - b),
          excludedRows: excludedRows.sort((a, b) => a - b),
          userExcludedRows,
          parentAssignments: parentAssignments.sort((a, b) => a.row - b.row),
        },
        rowPreview: current.rowPreview.map((candidate) =>
          candidate.row === row
            ? { ...candidate, kind, parentRow: null }
            : candidate.parentRow === row
              ? { ...candidate, parentRow: null }
              : candidate,
        ),
      };
    });
  }

  function excludeRow(row: number) {
    setReviewStale(true);
    setError(null);
    setAnalysis((current) => {
      if (!current) return current;
      const preview = current.rowPreview.find((candidate) => candidate.row === row);
      if (!preview || preview.kind !== "item") return current;
      return {
        ...current,
        plan: {
          ...current.plan,
          excludedRows: [...new Set([...current.plan.excludedRows, row])].sort(
            (a, b) => a - b,
          ),
          userExcludedRows: [...new Set([...current.plan.userExcludedRows, row])].sort(
            (a, b) => a - b,
          ),
        },
        rowPreview: current.rowPreview.map((candidate) =>
          candidate.row === row ? { ...candidate, kind: "excluded" } : candidate,
        ),
      };
    });
  }

  function restoreRow(row: number) {
    setReviewStale(true);
    setError(null);
    setAnalysis((current) => {
      if (!current) return current;
      if (current.plan.mandatoryExcludedRows.includes(row)) return current;
      const parentAssignments = current.plan.parentAssignments.some(
        (assignment) => assignment.row === row,
      )
        ? current.plan.parentAssignments
        : [...current.plan.parentAssignments, { row, parentRow: null }].sort(
            (a, b) => a.row - b.row,
          );
      return {
        ...current,
        plan: {
          ...current.plan,
          excludedRows: current.plan.excludedRows.filter((candidate) => candidate !== row),
          userExcludedRows: current.plan.userExcludedRows.filter(
            (candidate) => candidate !== row,
          ),
          parentAssignments,
        },
        rowPreview: current.rowPreview.map((candidate) =>
          candidate.row === row ? { ...candidate, kind: "item" } : candidate,
        ),
      };
    });
  }

  function updateParent(row: number, value: string) {
    const parentRow = value ? Number(value) : null;
    setReviewStale(true);
    setAnalysis((current) => {
      if (!current) return current;
      const parentAssignments = current.plan.parentAssignments.filter(
        (assignment) => assignment.row !== row,
      );
      parentAssignments.push({ row, parentRow });
      return {
        ...current,
        plan: {
          ...current.plan,
          parentAssignments: parentAssignments.sort((a, b) => a.row - b.row),
        },
        rowPreview: current.rowPreview.map((candidate) =>
          candidate.row === row ? { ...candidate, parentRow } : candidate,
        ),
      };
    });
  }

  async function reviewPlan() {
    if (!file || !analysis) return;
    setBusy(true);
    setError(null);
    try {
      const data = await uploadWorkbook(file, currentUserId, { plan: analysis.plan });
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/review`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: data,
        },
      );
      const body = await readJson<Analysis & { error?: string }>(response);
      if (!response.ok || !body?.plan) throw new Error(body?.error ?? t.projectImport.reviewFailed);
      setAnalysis(body);
      if (endDateInferred && answers.scheduleStart && body.plan.periodCount > 0) {
        setAnswers((current) => ({
          ...current,
          endDate: endDateForPeriodCount(
            current.scheduleStart,
            body.plan.periodCount,
            current.periodType,
            cycleLength(current),
          ),
        }));
      }
      setReviewStale(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectImport.reviewFailed);
    } finally {
      setBusy(false);
    }
  }

  async function createProject() {
    if (!file || !analysis) return;
    if (reviewStale) {
      setError(t.projectImport.revalidateRequired);
      return;
    }
    const scheduleProblem = getWorkbookScheduleIssue(
      scheduleAnswers(answers),
      analysis.plan,
    );
    if (scheduleProblem) {
      setServerScheduleIssue(scheduleProblem);
      setError(null);
      return;
    }
    if (analysis.summary.validationErrors.length > 0) {
      setRowErrors(analysis.summary.validationErrors);
      setError(t.projectImport.validationRequired);
      return;
    }
    if (
      analysis.weeklyProgressPreview?.confirmationRequired &&
      !acceptProgressDifference
    ) {
      setError(t.projectImport.progressConfirmationRequired);
      progressConfirmationRef.current?.focus();
      return;
    }
    if (
      !analysis.plan.weeklyProgress &&
      (!analysis.plan.mapping.fields.description ||
        !analysis.plan.mapping.fields.start ||
        !analysis.plan.mapping.fields.finish)
    ) {
      setError(t.projectImport.requiredMappings);
      return;
    }
    for (const question of QUESTIONS) {
      const problem = questionError(question);
      if (problem) {
        setError(problem);
        setReviewing(false);
        setQuestionIndex(QUESTIONS.indexOf(question));
        return;
      }
    }

    setBusy(true);
    setError(null);
    setRowErrors([]);
    try {
      const data = await uploadWorkbook(file, currentUserId, {
        confirmed: {
          plan: analysis.plan,
          acceptProgressDifference,
          project: {
            code: answers.code.trim().toUpperCase(),
            name: answers.name.trim(),
            client: answers.client.trim() || null,
            location: answers.location.trim() || null,
            startDate: answers.startDate,
            scheduleStart: answers.scheduleStart,
            endDate: answers.endDate,
            periodType: answers.periodType,
            periodLengthDays: cycleLength(answers),
          },
        },
      });
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/commit`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: data,
        },
      );
      const body = await readJson<{
        projectId?: string;
        error?: string;
        code?: string | null;
        details?: Record<string, unknown> | null;
        errors?: Analysis["summary"]["validationErrors"];
      }>(response);
      if (!response.ok || !body?.projectId) {
        setRowErrors(body?.errors ?? []);
        if (response.status === 409) {
          setCodeConflict(answers.code.trim().toUpperCase());
          setReviewing(false);
          setQuestionIndex(CODE_QUESTION_INDEX);
          setError(null);
          return;
        }
        if (
          body?.code === "period_count_mismatch" &&
          body.details &&
          typeof body.details.workbookPeriodCount === "number" &&
          typeof body.details.confirmedPeriodCount === "number" &&
          typeof body.details.suggestedEndDate === "string"
        ) {
          setServerScheduleIssue({
            code: "period_count_mismatch",
            workbookPeriodCount: body.details.workbookPeriodCount,
            confirmedPeriodCount: body.details.confirmedPeriodCount,
            suggestedEndDate: body.details.suggestedEndDate,
          });
          return;
        }
        if (
          body?.code === "schedule_range_exceeded" &&
          body.details &&
          typeof body.details.workbookPeriodCount === "number" &&
          typeof body.details.suggestedEndDate === "string"
        ) {
          setServerScheduleIssue({
            code: "schedule_range_exceeded",
            workbookPeriodCount: body.details.workbookPeriodCount,
            suggestedEndDate: body.details.suggestedEndDate,
          });
          return;
        }
        if (
          body?.code === "workbook_calendar_mismatch" &&
          body.details &&
          typeof body.details.suggestedStartDate === "string" &&
          typeof body.details.suggestedScheduleStartDate === "string" &&
          typeof body.details.suggestedEndDate === "string"
        ) {
          setServerScheduleIssue({
            code: "workbook_calendar_mismatch",
            suggestedStartDate: body.details.suggestedStartDate,
            suggestedScheduleStartDate: body.details.suggestedScheduleStartDate,
            suggestedEndDate: body.details.suggestedEndDate,
            differences: Array.isArray(body.details.differences)
              ? body.details.differences.filter(isCalendarDifference)
              : undefined,
          });
          return;
        }
        throw new Error(body?.error ?? t.projectImport.createFailed);
      }
      onOpenChange(false);
      reset();
      onCreated(body.projectId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t.projectImport.createFailed);
    } finally {
      setBusy(false);
    }
  }

  const questionLabels: Record<Question, string> = {
    name: t.projectImport.questionName,
    code: t.projectImport.questionCode,
    client: t.projectImport.questionClient,
    location: t.projectImport.questionLocation,
    startDate: t.projectImport.questionStart,
    scheduleStart: t.projectImport.questionScheduleStart,
    endDate: t.projectImport.questionEnd,
    periodType: t.projectImport.questionCadence,
  };
  const availableSections =
    analysis?.rowPreview.filter((row) => row.kind === "section") ?? [];
  const multiSheetWeekly = analysis?.plan.weeklyProgress != null;
  const weeklyPeriods = multiSheetWeekly ? reportingPeriodPreview(answers) : [];
  const progressConfirmationError =
    error === t.projectImport.progressConfirmationRequired;
  const selectedSheetName =
    sheetChoice === AUTO_SHEET ? recommendedSheetName : sheetChoice;
  const selectedSheet =
    sheets?.find((candidate) => candidate.sheetName === selectedSheetName) ?? null;
  const scheduleIssue = analysis && reviewing
    ? getWorkbookScheduleIssue(scheduleAnswers(answers), analysis.plan) ?? serverScheduleIssue
    : null;

  function useRecommendedSchedule() {
    if (!analysis || !scheduleIssue) return;
    setError(null);
    setServerScheduleIssue(null);
    setEndDateInferred(true);
    setAnswers((current) =>
      scheduleIssue.code !== "workbook_calendar_mismatch"
        ? { ...current, endDate: scheduleIssue.suggestedEndDate }
        : {
            ...current,
            startDate: scheduleIssue.suggestedStartDate,
            scheduleStart: scheduleIssue.suggestedScheduleStartDate,
            endDate: scheduleIssue.suggestedEndDate,
            periodType: analysis.plan.periodType,
            // The plan's cadence comes with its own length (always null today,
            // since no analysis proposes a custom one). Taking the type without
            // it would leave a stale length beside a calendar cadence.
            periodLengthDays:
              analysis.plan.periodLengthDays === null
                ? ""
                : String(analysis.plan.periodLengthDays),
          },
    );
  }

  function scheduleIssueAlert() {
    if (!scheduleIssue) return null;
    const description =
      scheduleIssue.code === "period_count_mismatch"
        ? interpolate(t.projectImport.periodMismatchDescription, {
            confirmed: scheduleIssue.confirmedPeriodCount,
            workbook: scheduleIssue.workbookPeriodCount,
            start: answers.scheduleStart,
            end: answers.endDate,
          })
        : scheduleIssue.code === "schedule_range_exceeded"
          ? interpolate(t.projectImport.scheduleRangeDescription, {
              workbook: scheduleIssue.workbookPeriodCount,
              end: scheduleIssue.suggestedEndDate,
            })
          : interpolate(t.projectImport.calendarMismatchDescription, {
              start: scheduleIssue.suggestedStartDate,
              scheduleStart: scheduleIssue.suggestedScheduleStartDate,
              end: scheduleIssue.suggestedEndDate,
            });
    const recommendedEnd = scheduleIssue.suggestedEndDate;

    return (
      <Alert variant="destructive" id="project-import-schedule-issue">
        <TriangleAlert />
        <AlertTitle>{t.projectImport.scheduleMismatchTitle}</AlertTitle>
        <AlertDescription>
          <p>{description}</p>
          {scheduleIssue.code === "workbook_calendar_mismatch" &&
            scheduleIssue.differences &&
            scheduleIssue.differences.length > 0 && (
              <p className="mt-1">
                {interpolate(t.projectImport.calendarMismatchFields, {
                  fields: scheduleIssue.differences
                    .map((field) => questionLabels[field])
                    .join(", "),
                })}
              </p>
            )}
          <p className="mt-1">{t.projectImport.scheduleMismatchHelp}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={useRecommendedSchedule}>
              {interpolate(t.projectImport.useRecommendedEnd, { date: recommendedEnd })}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError(null);
                if (reviewing) {
                  setReviewing(false);
                  setQuestionIndex(QUESTIONS.indexOf("endDate"));
                } else {
                  setReviewing(true);
                }
              }}
            >
              {reviewing ? t.projectImport.editDates : t.projectImport.reviewScheduleColumns}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[min(90svh,52rem)] overflow-y-auto sm:max-w-2xl" closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.projectImport.wizardTitle}</DialogTitle>
        </DialogHeader>
        <p className="sr-only" role="status" aria-live="polite">
          {busy ? t.projectImport.analyzing : ""}
        </p>

        {!analysis && !aiExhausted && remainingCredits !== null && (
          <p className="flex items-center justify-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5" />
            {plural(t.trial.aiCreditsLeft, remainingCredits)}
          </p>
        )}

        {!analysis && aiExhausted && (
          <div
            className="flex items-start gap-2.5 rounded-lg border border-dashed p-4 text-sm"
            role="status"
          >
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="font-medium">{t.trial.aiExhausted}</p>
              <p className="text-muted-foreground">{t.trial.aiExhaustedHint}</p>
            </div>
          </div>
        )}

        {!analysis && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <Upload className="mx-auto size-6 text-muted-foreground" />
            <Label htmlFor="project-workbook" className="mt-3 block text-sm font-medium">
              {t.projectImport.uploadLabel}
            </Label>
            <p id="project-import-file-hint" className="mt-1 text-muted-foreground">
              {t.projectImport.uploadHint}
            </p>
            <Input
              id="project-workbook"
              className="mx-auto mt-4 max-w-sm"
              type="file"
              accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy || discovering}
              aria-describedby="project-import-file-hint"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.currentTarget.value = "";
                if (chosen) void discover(chosen);
              }}
            />
            {discovering && (
              <p className="mt-4 flex items-center justify-center gap-2 text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                {t.projectUpdate.uploadingDiscover}
              </p>
            )}
            {sheets && sheets.length === 0 && (
              <p className="mt-4 text-destructive" role="alert">
                {t.projectUpdate.noSheets}
              </p>
            )}
            {sheets && sheets.length > 0 && (
              <div className="mx-auto mt-5 max-w-md space-y-3 text-left">
                <p className="text-muted-foreground">{t.projectUpdate.sheetHint}</p>
                <div className="space-y-2">
                  <Label htmlFor="project-import-sheet">{t.projectUpdate.sheetLabel}</Label>
                  <Select
                    items={[
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
                      ...sheets.map((candidate) => ({
                        value: candidate.sheetName,
                        label: interpolate(t.projectUpdate.sheetOption, {
                          name: candidate.sheetName,
                          state: t.projectUpdate.sheetStates[candidate.state],
                          rows: candidate.rowCount,
                          columns: candidate.columnCount,
                        }),
                      })),
                    ]}
                    value={sheetChoice}
                    onValueChange={(value) => setSheetChoice(value ?? "")}
                  >
                    <SelectTrigger id="project-import-sheet" className="w-full">
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
                  <div className="rounded-md border bg-background p-3">
                    <p className="font-medium">
                      {selectedSheet.knownSCurve
                        ? t.projectUpdate.knownSCurve
                        : t.projectUpdate.otherLayout}
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {selectedSheet.actualSnapshotCount > 0 &&
                      selectedSheet.latestActualPercent !== null
                        ? interpolate(t.projectUpdate.sheetActuals, {
                            count: selectedSheet.actualSnapshotCount,
                            percent: selectedSheet.latestActualPercent.toFixed(2),
                            period: selectedSheet.latestActualPeriodIndex ?? "-",
                          })
                        : t.projectUpdate.noSheetActuals}
                    </p>
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !file || !selectedSheetName}
                  onClick={() => {
                    if (file && selectedSheetName) void analyze(file, selectedSheetName);
                  }}
                >
                  {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                  {t.projectUpdate.analyzeAction}
                </Button>
              </div>
            )}
            {pdfPageCount !== null && (
              <div className="mx-auto mt-5 max-w-md space-y-3 text-left">
                <div className="rounded-md border bg-background p-3">
                  <p className="font-medium">{t.projectImport.pdfReady}</p>
                  <p className="mt-1 text-muted-foreground">
                    {interpolate(t.projectImport.pdfPages, { count: pdfPageCount })}
                  </p>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={busy || !file}
                  onClick={() => {
                    if (file) void analyze(file);
                  }}
                >
                  {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                  {t.projectImport.analyzePdfAction}
                </Button>
              </div>
            )}
            {busy && (
              <div className="mx-auto mt-5 max-w-sm text-left">
                <StepRunner
                  steps={ALL_STAGES.map((stage) => ({
                    id: stage,
                    label: t.projectImport.steps[stage],
                    skipped: skippedStages.includes(stage as ServerStage),
                  }))}
                  done={stagesDone}
                  label={t.projectImport.stepsLabel}
                />
              </div>
            )}
          </div>
        )}

        {analysis && !reviewing && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-muted-foreground">
              <span>{interpolate(t.projectImport.questionProgress, { current: questionIndex + 1, total: QUESTIONS.length })}</span>
              <span>
                {analysis.plan.profile === "reference-s-curve"
                  ? t.projectImport.knownFormat
                  : analysis.plan.profile === "generic-ai" || analysis.plan.profile === "pdf-ai"
                    ? t.projectImport.aiInterpreted
                    : t.projectImport.deterministicFallback}
              </span>
            </div>
            <div key={question} className="rounded-lg border bg-muted/30 p-4">
              <Label htmlFor="project-import-answer" className="text-sm font-medium">
                {questionLabels[question]}
              </Label>
              {question === "periodType" ? (
                <>
                <select
                  id="project-import-answer"
                  className="mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-base md:text-xs"
                  value={answers.periodType}
                  onChange={(event) => {
                    setServerScheduleIssue(null);
                    setAnswers((current) => {
                      const periodType = event.target.value as PeriodType;
                      const next = { ...current, periodType };
                      const cycle = cycleLength(next);
                      return {
                        ...next,
                        // Recomputed only when the cadence is complete. A
                        // custom one with no length yet has no end date to
                        // infer, and asking for one would throw.
                        endDate:
                          endDateInferred &&
                          current.scheduleStart &&
                          analysis &&
                          analysis.plan.periodCount > 0 &&
                          cadenceReady(next)
                            ? endDateForPeriodCount(
                                current.scheduleStart,
                                analysis.plan.periodCount,
                                periodType,
                                cycle,
                              )
                            : current.endDate,
                      };
                    });
                  }}
                  autoFocus
                >
                  {/* From the schema's own list, so a cadence added there
                      cannot go missing here. */}
                  {PERIOD_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {cadenceLabel(t, value)}
                    </option>
                  ))}
                </select>
                {/* Only a custom cadence has a length to ask about; the rest
                    take theirs from the calendar. */}
                {answers.periodType === "custom" && (
                  <div className="mt-3 space-y-1.5">
                    <Label htmlFor="project-import-cycle" className="text-sm font-medium">
                      {t.projects.periodLengthDays}
                    </Label>
                    <Input
                      id="project-import-cycle"
                      type="text"
                      inputMode="numeric"
                      value={answers.periodLengthDays}
                      aria-describedby="project-import-cycle-hint"
                      aria-invalid={
                        answers.periodLengthDays !== "" && cycleLength(answers) === null
                      }
                      onChange={(event) => {
                        setServerScheduleIssue(null);
                        const periodLengthDays = event.target.value
                          .replace(/[^0-9]/g, "")
                          .slice(0, 2);
                        setAnswers((current) => {
                          const next = { ...current, periodLengthDays };
                          const cycle = cycleLength(next);
                          return {
                            ...next,
                            endDate:
                              endDateInferred &&
                              current.scheduleStart &&
                              analysis &&
                              analysis.plan.periodCount > 0 &&
                              cycle !== null
                                ? endDateForPeriodCount(
                                    current.scheduleStart,
                                    analysis.plan.periodCount,
                                    next.periodType,
                                    cycle,
                                  )
                                : current.endDate,
                          };
                        });
                      }}
                    />
                    <p id="project-import-cycle-hint" className="text-xs text-muted-foreground">
                      {t.projects.periodLengthHint}
                    </p>
                  </div>
                )}
                </>
              ) : (
                <Input
                  id="project-import-answer"
                  className="mt-3"
                  type={
                    question === "startDate" ||
                    question === "scheduleStart" ||
                    question === "endDate"
                      ? "date"
                      : "text"
                  }
                  value={answers[question]}
                  aria-invalid={
                    (question === "code" && codeTaken) ||
                    (question === "endDate" && scheduleIssue)
                      ? true
                      : undefined
                  }
                  aria-describedby={
                    question === "code"
                      ? "project-import-code-status"
                      : question === "endDate" && scheduleIssue
                      ? "project-import-schedule-issue"
                      : undefined
                  }
                  maxLength={question === "code" ? 32 : 200}
                  autoFocus
                  onChange={(event) => {
                    const value = question === "code" ? event.target.value.toUpperCase() : event.target.value;
                    if (question === "endDate") setEndDateInferred(false);
                    if (question === "code") setCodeConflict(null);
                    setServerScheduleIssue(null);
                    setError(null);
                    setAnswers((current) => ({ ...current, [question]: value }));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void nextQuestion();
                    }
                  }}
                />
              )}
              {question === "code" && (
                <p
                  id="project-import-code-status"
                  className={`mt-2 min-h-4 ${codeTaken || codeCheckFailed ? "text-destructive" : "text-muted-foreground"}`}
                  role="status"
                  aria-live="polite"
                >
                  {codeTaken
                    ? interpolate(t.projects.codeTaken, { code: canonicalCode })
                    : codeCheckFailed
                      ? t.projectImport.codeCheckFailed
                      : codeCheckPending
                        ? t.projectImport.codeChecking
                        : ""}
                </p>
              )}
              {(question === "client" || question === "location") && (
                <p className="mt-2 text-muted-foreground">{t.projectImport.optionalHint}</p>
              )}
            </div>
          </div>
        )}

        {analysis && reviewing && (
          <div className="space-y-4">
            {scheduleIssueAlert()}
            <div className="grid gap-3 sm:grid-cols-4">
              <Summary label={t.projectImport.lines} value={analysis.summary.lineCount} />
              <Summary label={t.projectImport.sections} value={analysis.summary.sectionCount} />
              <Summary label={t.projectImport.periods} value={analysis.plan.periodCount} />
              <Summary
                label={t.projectImport.actualSnapshots}
                value={analysis.summary.actualSnapshotCount}
              />
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="font-medium">{answers.code} - {answers.name}</h3>
              <p className="mt-1 text-muted-foreground">
                {t.projectImport.contractStart}: {answers.startDate}
                {" · "}{t.projectImport.reportingStart}: {answers.scheduleStart}
                {" · "}{t.projectImport.completion}: {answers.endDate}
              </p>
              <p className="mt-1 text-muted-foreground">{analysis.plan.sheetName}</p>
              <p className="mt-2">
                {t.projectImport.totalAmount}: {money(analysis.summary.totalAmount)}
                {" · "}{t.projectImport.totalWeight}: {analysis.summary.totalWeight.toFixed(2)}%
              </p>
              {analysis.summary.latestActualPercent !== null && (
                <p className="mt-1">
                  {interpolate(t.projectImport.latestActual, {
                    percent: analysis.summary.latestActualPercent.toFixed(4),
                    period: analysis.summary.latestActualPeriodIndex ?? "-",
                  })}
                </p>
              )}
            </div>
            {analysis.weeklyProgressPreview && (
              <div className="space-y-3 rounded-lg border p-4">
                <div>
                  <h3 className="font-medium">{t.projectImport.weeklyProgressTitle}</h3>
                  <p className="mt-1 text-muted-foreground">
                    {interpolate(t.projectImport.weeklyProgressDescription, {
                      sheets: analysis.weeklyProgressPreview.detailSheetCount,
                      lines: analysis.summary.lineCount,
                      previous: analysis.weeklyProgressPreview.previousEntryCount,
                      current: analysis.weeklyProgressPreview.currentEntryCount,
                    })}
                  </p>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.periods}</th>
                        <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.targetPeriod}</th>
                        <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.aggregateProgress}</th>
                        <th scope="col" className="px-2 py-2 font-medium">{t.projectImport.itemizedProgress}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.actualSnapshots.map((snapshot) => {
                        const target = weeklyPeriods.find(
                          (period) => period.periodIndex === snapshot.periodIndex,
                        );
                        const itemized =
                          snapshot.periodIndex === analysis.weeklyProgressPreview?.previousPeriodIndex
                            ? analysis.weeklyProgressPreview.itemizedPreviousPercent
                            : snapshot.periodIndex === analysis.weeklyProgressPreview?.currentPeriodIndex
                              ? analysis.weeklyProgressPreview.itemizedCurrentPercent
                              : null;
                        return (
                          <tr key={snapshot.periodIndex} className="border-t">
                            <td className="px-2 py-2 tabular-nums">{snapshot.periodIndex}</td>
                            <td className="px-2 py-2 tabular-nums">
                              {target ? `${target.periodIndex} · ${target.endDate}` : snapshot.periodIndex}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {snapshot.cumulativePercent.toFixed(4)}%
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {itemized === null ? "-" : `${itemized.toFixed(4)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {analysis.weeklyProgressPreview.confirmationRequired && (
                  <div className="grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <Checkbox
                      ref={progressConfirmationRef}
                      id="project-import-progress-confirmation"
                      checked={acceptProgressDifference}
                      disabled={busy}
                      aria-invalid={progressConfirmationError || undefined}
                      aria-describedby={
                        progressConfirmationError
                          ? "project-import-progress-confirmation-hint project-import-progress-confirmation-error"
                          : "project-import-progress-confirmation-hint"
                      }
                      onCheckedChange={(checked) => {
                        setAcceptProgressDifference(checked === true);
                        setError(null);
                      }}
                    />
                    <Label htmlFor="project-import-progress-confirmation">
                      {t.projectImport.confirmProgressDifference}
                    </Label>
                    <p
                      id="project-import-progress-confirmation-hint"
                      className="col-start-2 text-muted-foreground"
                    >
                      {interpolate(t.projectImport.progressDifferenceHint, {
                        aggregate: analysis.weeklyProgressPreview.aggregateCurrentPercent.toFixed(4),
                        itemized: analysis.weeklyProgressPreview.itemizedCurrentPercent.toFixed(4),
                      })}
                    </p>
                    {progressConfirmationError && (
                      <p
                        id="project-import-progress-confirmation-error"
                        className="col-start-2 text-destructive"
                      >
                        {t.projectImport.progressConfirmationRequired}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="rounded-lg border p-4">
              <h3 className="font-medium">{t.projectImport.rowReviewTitle}</h3>
              <p className="mt-1 text-muted-foreground">
                {multiSheetWeekly
                  ? interpolate(t.projectImport.multiSheetSource, {
                      sheets: analysis.weeklyProgressPreview?.detailSheetCount ?? 0,
                      categories: analysis.weeklyProgressPreview?.categoryCount ?? 0,
                    })
                  : interpolate(t.projectImport.rowRange, {
                      first: analysis.plan.dataStartRow,
                      last: analysis.plan.dataEndRow,
                    })}
              </p>
              <div
                className="mt-3 max-h-64 overflow-y-auto rounded-md border"
                role="region"
                aria-label={t.projectImport.rowReviewTitle}
                tabIndex={0}
              >
                {analysis.rowPreview.map((row) => (
                  <div
                    key={row.row}
                    className="grid grid-cols-[3rem_5rem_minmax(0,1fr)] items-center gap-2 border-b px-2 py-2 last:border-b-0 sm:grid-cols-[3rem_5rem_minmax(0,1fr)_10rem]"
                  >
                    <span
                      className="tabular-nums text-muted-foreground"
                      title={
                        row.sourcePage
                          ? interpolate(t.projectImport.pdfRowSource, {
                              page: row.sourcePage,
                              row: row.sourceRow ?? row.row,
                            })
                          : undefined
                      }
                    >
                      {row.sourcePage ? `p${row.sourcePage}:${row.sourceRow ?? row.row}` : row.row}
                    </span>
                    {analysis.plan.profile === "reference-s-curve" || row.kind === "excluded" ? (
                      <span>{t.projectImport.rowKinds[row.kind]}</span>
                    ) : (
                      <select
                        className="rounded border border-input bg-background px-1"
                        value={row.kind}
                        aria-label={interpolate(t.projectImport.rowKindLabel, { row: row.row })}
                        onChange={(event) =>
                          updateRowKind(
                            row.row,
                            event.target.value as "item" | "section",
                          )
                        }
                      >
                        <option value="item">{t.projectImport.rowKinds.item}</option>
                        <option value="section">{t.projectImport.rowKinds.section}</option>
                      </select>
                    )}
                    <span className="truncate" title={row.description}>{row.description}</span>
                    {multiSheetWeekly ? (
                      <span
                        className="col-span-2 col-start-2 truncate text-muted-foreground sm:col-auto"
                        title={`${row.sourceSheet ?? "-"}:${row.sourceRow ?? row.row}`}
                      >
                        {row.sourceSheet ?? "-"}:{row.sourceRow ?? row.row}
                      </span>
                    ) : row.kind === "item" ? (
                      <div className="col-span-2 col-start-2 flex items-center gap-2 sm:col-auto">
                        <select
                          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                          value={row.parentRow ?? ""}
                          aria-label={interpolate(t.projectImport.parentLabel, { row: row.row })}
                          onChange={(event) => updateParent(row.row, event.target.value)}
                        >
                          <option value="">{t.projectImport.topLevel}</option>
                          {availableSections.map((section) => (
                            <option key={section.row} value={section.row}>
                              {section.row} · {section.description}
                            </option>
                          ))}
                        </select>
                        <Button
                          size="icon-sm"
                          variant="destructive"
                          aria-label={interpolate(t.projectImport.removeRowLabel, { row: row.row })}
                          title={interpolate(t.projectImport.removeRowLabel, { row: row.row })}
                          onClick={() => excludeRow(row.row)}
                        >
                          <X />
                        </Button>
                      </div>
                    ) : row.kind === "excluded" ? (
                      analysis.plan.mandatoryExcludedRows.includes(row.row) ? (
                        <span className="col-span-2 col-start-2 text-muted-foreground sm:col-auto">
                          {t.projectImport.requiredExclusion}
                        </span>
                      ) : (
                        <Button
                          className="col-span-2 col-start-2 justify-self-start sm:col-auto"
                          size="sm"
                          variant="outline"
                          onClick={() => restoreRow(row.row)}
                        >
                          {t.projectImport.restoreRow}
                        </Button>
                      )
                    ) : (
                      <span className="hidden text-muted-foreground sm:block" aria-hidden="true">-</span>
                    )}
                    {analysis.plan.profile === "pdf-ai" && (
                      <dl className="col-span-full grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-muted/40 p-2 text-xs sm:grid-cols-4">
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.pdfSource}</dt>
                          <dd>{`p${row.sourcePage}:${row.sourceRow} · ${row.sourceTable}`}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.sourceCode}</dt>
                          <dd>{row.code ?? "-"}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.mappingFields.quantity}</dt>
                          <dd>{row.quantity ?? "-"} {row.unit ?? ""}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.mappingFields.unitRate}</dt>
                          <dd>{row.unitRate === null ? "-" : money(row.unitRate)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.mappingFields.amount}</dt>
                          <dd>{row.amount === null ? "-" : money(row.amount)}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.mappingFields.weight}</dt>
                          <dd>{row.weight === null ? "-" : `${row.weight.toFixed(4)}%`}</dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">{t.projectImport.periods}</dt>
                          <dd>
                            {row.startPeriodIndex === null || row.finishPeriodIndex === null
                              ? "-"
                              : `${row.startPeriodIndex}-${row.finishPeriodIndex}`}
                          </dd>
                        </div>
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {analysis.plan.profile === "pdf-ai" &&
              (analysis.pdfActualPreview?.length ?? 0) > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="font-medium">{t.projectImport.actualSnapshots}</h3>
                <div
                  className="mt-3 max-h-48 overflow-auto rounded-md border"
                  role="region"
                  aria-label={t.projectImport.actualSnapshots}
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
            {analysis.plan.profile !== "pdf-ai" && !multiSheetWeekly && (
            <div className="rounded-lg border p-4">
              <h3 className="font-medium">{t.projectImport.mappingTitle}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([
                  "description",
                  "unit",
                  "quantity",
                  "unitRate",
                  "amount",
                  "weight",
                  "start",
                  "finish",
                ] as MappingField[]).map((field) => (
                  <label key={field} className="grid gap-1">
                    <span>{t.projectImport.mappingFields[field]}</span>
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-base md:text-xs"
                      value={analysis.plan.mapping.fields[field] ?? ""}
                      onChange={(event) => updateMapping(field, event.target.value)}
                      required={field === "description" || field === "start" || field === "finish"}
                    >
                      <option value="">{t.projectImport.notMapped}</option>
                      {analysis.columns.map((column) => (
                        <option key={column.index} value={column.index}>
                          {column.letter} · {column.header || column.samples[0] || t.projectImport.unnamedColumn}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
            )}
            {analysis.plan.warnings.length > 0 && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>{t.projectImport.reviewNotes}</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc space-y-1 ps-4">
                    {analysis.plan.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {reviewStale && (
              <Alert>
                <TriangleAlert />
                <AlertTitle>{t.projectImport.revalidateTitle}</AlertTitle>
                <AlertDescription>{t.projectImport.revalidateDescription}</AlertDescription>
              </Alert>
            )}
            {analysis.summary.validationErrors.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{t.projectImport.validationTitle}</AlertTitle>
                <AlertDescription>
                  {analysis.summary.validationErrors
                    .slice(0, 5)
                    .map((item) => interpolate(t.projectImport.rowError, { row: item.row, message: item.message }))
                    .join(" ")}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{t.projectImport.importNeedsAttention}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {rowErrors.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded-md border border-destructive/30 p-3 text-destructive">
            {rowErrors.map((item, index) => (
              <p key={`${item.row}-${item.column}-${index}`}>
                {interpolate(t.projectImport.rowError, { row: item.row, message: item.message })}
              </p>
            ))}
          </div>
        )}

        {analysis && (
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(null);
                if (reviewing) setReviewing(false);
                else if (questionIndex > 0) setQuestionIndex((current) => current - 1);
              }}
            >
              {t.common.back}
            </Button>
            {reviewing ? (
              reviewStale ? (
                <Button disabled={busy} onClick={() => void reviewPlan()}>
                  {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                  {t.projectImport.revalidateAction}
                </Button>
              ) : (
                <Button disabled={busy || !cadenceReady(answers)} onClick={() => void createProject()}>
                  {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                  {t.projectImport.createAction}
                </Button>
              )
            ) : (
              <Button
                disabled={busy || (question === "periodType" && !cadenceReady(answers))}
                onClick={() => void nextQuestion()}
              >
                {busy && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                {t.common.continue}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <span className="text-muted-foreground">{label}</span>
      <strong className="mt-1 block text-lg tabular-nums">{value}</strong>
    </div>
  );
}
