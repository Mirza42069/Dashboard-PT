"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { CheckCircle2, CircleDashed, CircleDot } from "@DashboardV2/ui/components/icons";
import { cn } from "@DashboardV2/ui/lib/utils";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { deviationPosition } from "@DashboardV2/api/lib/deviation";

import { DeviationBadge } from "@/components/deviation-badge";
import { QueryError } from "@/components/query-error";
import { TickBar } from "@/components/tick-bar";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

type OverviewProject = {
  id: string;
  client: string | null;
  location: string | null;
  startDate: string | null;
  endDate: string | null;
  scheduleStart: string | null;
  periodType: "weekly" | "biweekly" | "monthly";
  notes: string | null;
  manager: { name: string; email: string } | null;
  contractValue: number | null;
  workCompletedValue: number | null;
  remainingContractValue: number | null;
  valueCompletionPercent: number | null;
  openTickets: number;
  progressPercent: number;
  progressSource: "boq" | "manual";
  plannedPercent: number | null;
  deviation: number | null;
  dataDate: string | null;
};

type WorkStage = {
  id: string;
  name: string;
  progress: number;
  state: "complete" | "in_progress" | "not_started";
};

export default function ProjectOverview({ project }: { project: OverviewProject }) {
  const t = useT();
  const { money, percent, formatDate } = useFormat();
  const workStagesQuery = useQuery(
    trpc.progress.workStages.queryOptions({ projectId: project.id }),
  );
  const complete = Math.min(100, Math.max(0, project.progressPercent));
  const progressPosition =
    project.progressSource === "boq" ? deviationPosition(project.deviation) : null;
  const progressTone =
    progressPosition === "behind"
      ? "destructive"
      : progressPosition === "on_track" || progressPosition === "ahead"
        ? "success"
        : "default";
  // The bar answers "how far along" and nothing else. Behind schedule used to
  // cross over and paint it red, which stopped working once red became the
  // bottom of the progress ramp — the number above and the deviation badge
  // below both already say it, in words this bar could not.
  const cadence = {
    weekly: t.projects.periodWeekly,
    biweekly: t.projects.periodBiweekly,
    monthly: t.projects.periodMonthly,
  }[project.periodType];

  return (
    <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)_19rem]">
      <Card className="xl:row-span-2">
        <CardHeader>
          <CardTitle>{t.projects.workStages}</CardTitle>
        </CardHeader>
        <CardContent>
          {workStagesQuery.isPending && (
            <div className="space-y-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          )}

          {workStagesQuery.isError && (
            <QueryError
              error={workStagesQuery.error}
              onRetry={() => void workStagesQuery.refetch()}
              className="border-0 px-2 py-8"
            />
          )}

          {!workStagesQuery.isPending && !workStagesQuery.isError && (
            <WorkStageList stages={workStagesQuery.data ?? []} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.projects.workProgress}</CardTitle>
          <CardDescription>
            {project.progressSource === "boq"
              ? t.projects.progressFromBoq
              : t.projects.noBaselineYet}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p
              className={cn(
                "text-2xl font-semibold tabular-nums",
                progressTone === "destructive" && "text-destructive",
                progressTone === "success" && "text-success",
              )}
            >
              {complete.toFixed(project.progressSource === "boq" ? 1 : 0)}%
            </p>
            <p className="text-muted-foreground">{t.projects.complete}</p>
          </div>
          {/* TickBar is visual-only, so its wrapper carries the native meter
              semantics while the same figure remains visible above. */}
          <span
            role="meter"
            aria-label={t.projects.progressMeter}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={complete}
            aria-valuetext={percent(complete)}
            className="block"
          >
            <TickBar value={complete} max={100} />
          </span>
          {project.progressSource === "boq" && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3">
              <span className="text-muted-foreground">
                {t.projects.plannedProgress}: {percent(project.plannedPercent ?? 0)}
              </span>
              <DeviationBadge value={project.deviation} />
              {project.dataDate && (
                <span className="text-muted-foreground">
                  {interpolate(t.projects.asOf, { date: formatDate(project.dataDate) })}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="xl:row-span-2">
        <CardHeader>
          <CardTitle>{t.projects.financialOverview}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Metric
            label={t.projects.contractValueTile}
            value={project.contractValue === null ? "—" : money(project.contractValue)}
          />
          <Metric
            label={t.projects.workCompleted}
            value={
              project.workCompletedValue === null ? "—" : money(project.workCompletedValue)
            }
            hint={
              project.valueCompletionPercent === null
                ? undefined
                : percent(project.valueCompletionPercent)
            }
          />
          <Metric
            label={t.projects.remainingContractValue}
            value={
              project.remainingContractValue === null
                ? "—"
                : money(project.remainingContractValue)
            }
          />
          <Metric label={t.projects.openTicketsColumn} value={String(project.openTickets)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.projects.projectDetails}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Detail label={t.projects.client} value={project.client ?? "—"} />
            <Detail label={t.projects.location} value={project.location ?? "—"} />
            <Detail label={t.projects.startDate} value={formatDate(project.startDate)} />
            <Detail label={t.projects.targetCompletion} value={formatDate(project.endDate)} />
            <Detail label={t.projects.manager} value={project.manager?.name ?? t.common.unassigned} />
            <Detail label={t.projects.periodType} value={cadence} />
            <Detail label={t.projects.scheduleStart} value={formatDate(project.scheduleStart)} />
          </dl>
          {project.notes && (
            <div className="mt-4 border-t pt-4">
              <p className="text-muted-foreground">{t.projects.notes}</p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">{project.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkStageList({ stages }: { stages: WorkStage[] }) {
  const t = useT();

  if (stages.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">{t.projects.noWorkStages}</p>;
  }

  return (
    <ol className="space-y-1">
      {stages.map((stage) => {
        const Icon =
          stage.state === "complete"
            ? CheckCircle2
            : stage.state === "in_progress"
              ? CircleDot
              : CircleDashed;
        const label =
          stage.state === "complete"
            ? t.projects.stageComplete
            : stage.state === "in_progress"
              ? t.projects.stageInProgress
              : t.projects.stageNotStarted;

        return (
          <li key={stage.id} className="flex gap-2.5 rounded-md px-2 py-2.5">
            <Icon
              className={
                stage.state === "complete"
                  ? "mt-0.5 size-4 shrink-0 text-primary"
                  : "mt-0.5 size-4 shrink-0 text-muted-foreground"
              }
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-foreground">{stage.name}</p>
              <p className="text-muted-foreground">
                {label} - {stage.progress.toFixed(0)}%
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-b pb-4 last:border-0 last:pb-0">
      <p className="text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="tabular-nums text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}
