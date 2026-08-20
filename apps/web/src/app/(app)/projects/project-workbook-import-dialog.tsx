"use client";

import { env } from "@DashboardV2/env/web";
import { endDateForPeriodCount, generatePeriods } from "@DashboardV2/api/lib/periods";
import { Alert, AlertDescription, AlertTitle } from "@DashboardV2/ui/components/alert";
import { Button } from "@DashboardV2/ui/components/button";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { StepRunner } from "@/components/step-runner";
import { interpolate, plural } from "@/i18n";
import { useLocale, useT } from "@/i18n/provider";
import { getServerUrl } from "@/lib/server-url";
import { useDebounced } from "@/lib/use-debounced";
import {
  createWorkbookTransport,
  WORKBOOK_TRANSPORT_CONTENT_TYPE,
} from "@/lib/workbook-transport";
import { trpc } from "@/utils/trpc";

type PeriodType = "weekly" | "biweekly" | "monthly";
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
  profile: "reference-s-curve" | "generic-ai" | "generic-deterministic";
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
  periodCount: number;
  confidence: "high" | "medium" | "low";
  warnings: string[];
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
  }[];
  rowPreview: {
    row: number;
    description: string;
    kind: "item" | "section" | "excluded";
    parentRow: number | null;
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
type Answers = {
  name: string;
  code: string;
  client: string;
  location: string;
  startDate: string;
  scheduleStart: string;
  endDate: string;
  periodType: PeriodType;
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
};
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
const CODE_QUESTION_INDEX = QUESTIONS.indexOf("code");

type PeriodCountIssue = {
  code: "period_count_mismatch";
  workbookPeriodCount: number;
  confirmedPeriodCount: number;
  suggestedEndDate: string;
};

type WorkbookCalendarIssue = {
  code: "workbook_calendar_mismatch";
  suggestedStartDate: string;
  suggestedScheduleStartDate: string;
  suggestedEndDate: string;
};

type ScheduleRangeIssue = {
  code: "schedule_range_exceeded";
  workbookPeriodCount: number;
  suggestedEndDate: string;
};

type ScheduleIssue = PeriodCountIssue | WorkbookCalendarIssue | ScheduleRangeIssue;

function getPeriodCountIssue(
  answers: Answers,
  plan: Plan,
): PeriodCountIssue | ScheduleRangeIssue | null {
  if (!answers.scheduleStart || !answers.endDate || plan.periodCount < 1) return null;
  try {
    const confirmedPeriodCount = generatePeriods(
      answers.scheduleStart,
      answers.endDate,
      answers.periodType,
    ).length;
    if (confirmedPeriodCount === plan.periodCount) return null;
    return {
      code: "period_count_mismatch",
      workbookPeriodCount: plan.periodCount,
      confirmedPeriodCount,
      suggestedEndDate: endDateForPeriodCount(
        answers.scheduleStart,
        plan.periodCount,
        answers.periodType,
      ),
    };
  } catch {
    try {
      return {
        code: "schedule_range_exceeded",
        workbookPeriodCount: plan.periodCount,
        suggestedEndDate: endDateForPeriodCount(
          answers.scheduleStart,
          plan.periodCount,
          answers.periodType,
        ),
      };
    } catch {
      return null;
    }
  }
}

function getWorkbookCalendarIssue(
  answers: Answers,
  plan: Plan,
): WorkbookCalendarIssue | null {
  if (
    plan.profile !== "reference-s-curve" ||
    !plan.suggestedStartDate ||
    !plan.suggestedScheduleStartDate ||
    !plan.suggestedEndDate
  ) {
    return null;
  }
  if (
    answers.startDate === plan.suggestedStartDate &&
    answers.scheduleStart === plan.suggestedScheduleStartDate &&
    answers.endDate === plan.suggestedEndDate &&
    answers.periodType === plan.periodType
  ) {
    return null;
  }
  return {
    code: "workbook_calendar_mismatch",
    suggestedStartDate: plan.suggestedStartDate,
    suggestedScheduleStartDate: plan.suggestedScheduleStartDate,
    suggestedEndDate: plan.suggestedEndDate,
  };
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Mirrors NDJSON_CONTENT_TYPE in apps/server/src/index.ts. */
const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** The stages the server reports, in the order it reports them. */
const SERVER_STAGES = ["reading", "recognising", "interpreting", "building"] as const;
type ServerStage = (typeof SERVER_STAGES)[number];

/** The two the browser can time itself: compressing the file, then sending it. */
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
  trialAiCredits,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (projectId: string) => void;
  /** AI imports this trial has left; null on an account with no trial. */
  trialAiCredits: number | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [reviewStale, setReviewStale] = useState(false);
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
    setAnalysis(null);
    setAnswers(EMPTY);
    setQuestionIndex(0);
    setReviewing(false);
    setReviewStale(false);
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

  async function analyze(chosen: File) {
    setBusy(true);
    setError(null);
    setAiExhausted(false);
    setStagesDone(0);
    setSkippedStages([]);
    seenStages.current.clear();
    try {
      const data = await createWorkbookTransport(chosen);
      // Compression is done; the upload is the next thing the user waits on.
      setStagesDone(1);
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/analyze`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": WORKBOOK_TRANSPORT_CONTENT_TYPE,
            // Asks for stage-by-stage progress. The route still answers with a
            // single JSON body without this, which is what readAnalysis falls
            // back to when a proxy buffers the stream away.
            Accept: NDJSON_CONTENT_TYPE,
          },
          body: data,
        },
      );
      // Headers are in, so the bytes are up.
      setStagesDone(2);
      const body = await readAnalysis(response, {
        onStage: (stage) => {
          const index = SERVER_STAGES.indexOf(stage);
          if (index === -1) return;
          setStagesDone(CLIENT_STAGE_COUNT + index);
          // Reaching `building` without `interpreting` means the workbook was
          // recognised outright and the model was never called for it.
          if (stage === "building" && !seenStages.current.has("interpreting")) {
            setSkippedStages(["interpreting"]);
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
      setFile(chosen);
      setAnalysis(body);
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
      const data = await createWorkbookTransport(file, { plan: analysis.plan });
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/review`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": WORKBOOK_TRANSPORT_CONTENT_TYPE },
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
    const scheduleProblem =
      getWorkbookCalendarIssue(answers, analysis.plan) ??
      getPeriodCountIssue(answers, analysis.plan);
    if (scheduleProblem) {
      setServerScheduleIssue(scheduleProblem);
      setError(null);
      return;
    }
    if (reviewStale) {
      setError(t.projectImport.revalidateRequired);
      return;
    }
    if (analysis.summary.validationErrors.length > 0) {
      setRowErrors(analysis.summary.validationErrors);
      setError(t.projectImport.validationRequired);
      return;
    }
    if (
      !analysis.plan.mapping.fields.description ||
      !analysis.plan.mapping.fields.start ||
      !analysis.plan.mapping.fields.finish
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
      const data = await createWorkbookTransport(file, {
        confirmed: {
          plan: analysis.plan,
          project: {
            code: answers.code.trim().toUpperCase(),
            name: answers.name.trim(),
            client: answers.client.trim() || null,
            location: answers.location.trim() || null,
            startDate: answers.startDate,
            scheduleStart: answers.scheduleStart,
            endDate: answers.endDate,
            periodType: answers.periodType,
          },
        },
      });
      const response = await fetch(
        `${getServerUrl(env.NEXT_PUBLIC_SERVER_URL)}/project-import/commit`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": WORKBOOK_TRANSPORT_CONTENT_TYPE },
          body: data,
        },
      );
      const body = await readJson<{
        projectId?: string;
        error?: string;
        code?: string | null;
        details?: Record<string, string | number | null> | null;
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
  const scheduleIssue = analysis
    ? getWorkbookCalendarIssue(answers, analysis.plan) ??
      getPeriodCountIssue(answers, analysis.plan) ??
      serverScheduleIssue
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
            <p className="mt-1 text-muted-foreground">{t.projectImport.uploadHint}</p>
            <Input
              id="project-workbook"
              className="mx-auto mt-4 max-w-sm"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.currentTarget.value = "";
                if (chosen) void analyze(chosen);
              }}
            />
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
                  : analysis.plan.profile === "generic-ai"
                    ? t.projectImport.aiInterpreted
                    : t.projectImport.deterministicFallback}
              </span>
            </div>
            <div key={question} className="rounded-lg border bg-muted/30 p-4">
              <Label htmlFor="project-import-answer" className="text-sm font-medium">
                {questionLabels[question]}
              </Label>
              {question === "periodType" ? (
                <select
                  id="project-import-answer"
                  className="mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-base md:text-xs"
                  value={answers.periodType}
                  onChange={(event) => {
                    setServerScheduleIssue(null);
                    setAnswers((current) => {
                      const periodType = event.target.value as PeriodType;
                      return {
                        ...current,
                        periodType,
                        endDate:
                          endDateInferred &&
                          current.scheduleStart &&
                          analysis &&
                          analysis.plan.periodCount > 0
                            ? endDateForPeriodCount(
                                current.scheduleStart,
                                analysis.plan.periodCount,
                                periodType,
                              )
                            : current.endDate,
                      };
                    });
                  }}
                  autoFocus
                >
                  <option value="weekly">{t.projects.periodWeekly}</option>
                  <option value="biweekly">{t.projects.periodBiweekly}</option>
                  <option value="monthly">{t.projects.periodMonthly}</option>
                </select>
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
              {question === "endDate" && scheduleIssue && (
                <div className="mt-3">{scheduleIssueAlert()}</div>
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
                {t.projectImport.totalAmount}: {new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", { maximumFractionDigits: 0 }).format(analysis.summary.totalAmount)}
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
            <div className="rounded-lg border p-4">
              <h3 className="font-medium">{t.projectImport.rowReviewTitle}</h3>
              <p className="mt-1 text-muted-foreground">
                {interpolate(t.projectImport.rowRange, {
                  first: analysis.plan.dataStartRow,
                  last: analysis.plan.dataEndRow,
                })}
              </p>
              <div className="mt-3 max-h-44 overflow-y-auto rounded-md border">
                {analysis.rowPreview.map((row) => (
                  <div
                    key={row.row}
                    className="grid grid-cols-[3rem_5rem_minmax(0,1fr)] items-center gap-2 border-b px-2 py-2 last:border-b-0 sm:grid-cols-[3rem_5rem_minmax(0,1fr)_10rem]"
                  >
                    <span className="tabular-nums text-muted-foreground">{row.row}</span>
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
                    {row.kind === "item" ? (
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
                  </div>
                ))}
              </div>
            </div>
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
                  {busy && <Loader2 className="animate-spin" />}
                  {t.projectImport.revalidateAction}
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => void createProject()}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t.projectImport.createAction}
                </Button>
              )
            ) : (
              <Button disabled={busy} onClick={() => void nextQuestion()}>
                {busy && <Loader2 className="animate-spin" />}
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
