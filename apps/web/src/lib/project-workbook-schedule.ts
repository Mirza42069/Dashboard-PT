import { endDateForPeriodCount, generatePeriods } from "@DashboardV2/api/lib/periods";
import type { PeriodType } from "@DashboardV2/db/schema";

export type PeriodCountIssue = {
  code: "period_count_mismatch";
  workbookPeriodCount: number;
  confirmedPeriodCount: number;
  suggestedEndDate: string;
};

export type WorkbookCalendarIssue = {
  code: "workbook_calendar_mismatch";
  suggestedStartDate: string;
  suggestedScheduleStartDate: string;
  suggestedEndDate: string;
  differences?: ("startDate" | "scheduleStart" | "endDate" | "periodType")[];
};

export type ScheduleRangeIssue = {
  code: "schedule_range_exceeded";
  workbookPeriodCount: number;
  suggestedEndDate: string;
};

export type ScheduleIssue = PeriodCountIssue | WorkbookCalendarIssue | ScheduleRangeIssue;

type ScheduleAnswers = {
  startDate: string;
  scheduleStart: string;
  endDate: string;
  periodType: PeriodType;
  periodLengthDays: number | null;
};

type SchedulePlan = {
  profile: "reference-s-curve" | "generic-ai" | "generic-deterministic";
  periodCount: number;
  suggestedStartDate: string | null;
  suggestedScheduleStartDate: string | null;
  suggestedEndDate: string | null;
  periodType: PeriodType;
};

export function getWorkbookScheduleIssue(
  answers: ScheduleAnswers,
  plan: SchedulePlan,
): ScheduleIssue | null {
  if (
    plan.profile === "reference-s-curve" &&
    plan.suggestedStartDate &&
    plan.suggestedScheduleStartDate &&
    plan.suggestedEndDate
  ) {
    const differences: WorkbookCalendarIssue["differences"] = [];
    if (answers.startDate !== plan.suggestedStartDate) differences.push("startDate");
    if (answers.scheduleStart !== plan.suggestedScheduleStartDate) {
      differences.push("scheduleStart");
    }
    if (answers.endDate !== plan.suggestedEndDate) differences.push("endDate");
    if (answers.periodType !== plan.periodType) differences.push("periodType");
    if (differences.length > 0) {
      return {
        code: "workbook_calendar_mismatch",
        suggestedStartDate: plan.suggestedStartDate,
        suggestedScheduleStartDate: plan.suggestedScheduleStartDate,
        suggestedEndDate: plan.suggestedEndDate,
        differences,
      };
    }
  }

  if (!answers.scheduleStart || !answers.endDate || plan.periodCount < 1) return null;
  try {
    const confirmedPeriodCount = generatePeriods(
      answers.scheduleStart,
      answers.endDate,
      answers.periodType,
      answers.periodLengthDays,
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
        answers.periodLengthDays,
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
          answers.periodLengthDays,
        ),
      };
    } catch {
      return null;
    }
  }
}
