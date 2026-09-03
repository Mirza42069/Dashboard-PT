"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@DashboardV2/ui/components/alert-dialog";
import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Lock, Upload } from "@DashboardV2/ui/components/icons";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { Hint } from "@/components/hint";
import { useT } from "@/i18n/provider";
import type { BaselineStep } from "@/lib/project-navigation";
import {
  buildSections,
  distributionMap,
  scheduleRows,
  sectionAmount,
  totalLeafWeight,
} from "@/lib/boq/curves";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import BoqImportDialog from "./boq-import-dialog";
import BoqTab from "./boq-tab";
import ScheduleTab from "./schedule-tab";

const ROW_TOLERANCE = 0.5;

/**
 * BoQ, schedule and review, in that order.
 *
 * The step lives in the URL rather than in this component, so the two heaviest
 * screens in the product are linkable and the back button works between them.
 * It stays a stepper rather than becoming three unrelated tabs because the
 * order is real — there is nothing to schedule until the priced lines exist,
 * which is what schedule.needsBoq refuses.
 */
export default function BaselineTab({
  projectId,
  canEdit,
  step,
  onStepChange,
}: {
  projectId: string;
  canEdit: boolean;
  step: BaselineStep;
  onStepChange: (step: BaselineStep) => void;
}) {
  const t = useT();
  const [importing, setImporting] = useState(false);
  const versionsQuery = useQuery(trpc.boq.listVersions.queryOptions({ projectId }));

  if (versionsQuery.isPending) return <Skeleton className="h-64 w-full" />;
  if (versionsQuery.isError) {
    return <QueryError error={versionsQuery.error} onRetry={() => void versionsQuery.refetch()} />;
  }

  const versions = versionsQuery.data ?? [];
  const active = versions.find(
    (version) => version.status === "active" && version.scheduleStatus === "active",
  );
  const target =
    versions.find((version) => version.status === "draft") ??
    versions.find(
      (version) => version.status === "active" && version.scheduleStatus === "draft",
    );
  const setupMode = Boolean(target);
  /*
   * There is nothing to review until a draft exists, and a project with no
   * baseline review can be linked before a draft exists. Falling back to
   * the first step is what that link should have meant all along — the
   * alternative is a header with an empty page under it.
   */
  const shown = step === "review" && !target ? "boq" : step;

  return (
    <div className="space-y-3">
      {(target || active) && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  {t.baseline.title}
                  <Badge variant={setupMode ? "outline" : "secondary"}>
                    {target
                      ? interpolate(t.boq.revision, { number: target.versionNo })
                      : interpolate(t.boq.revision, { number: active?.versionNo ?? 1 })}
                    {` - ${setupMode ? t.boq.draft : t.boq.active}`}
                  </Badge>
                  {target && active && (
                    <Hint text={interpolate(t.baseline.activeUnaffected, { number: active.versionNo })} />
                  )}
                </CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/*
                 * Offered only while no draft is open. The import creates a
                 * draft revision, and a project may hold exactly one — so
                 * showing the button beside an existing draft would promise
                 * something the server is right to refuse.
                 */}
                {canEdit && !setupMode && (
                  <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                    <Upload />
                    {t.boqImport.trigger}
                  </Button>
                )}
                <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
                <StepButton
                  number={1}
                  label={t.baseline.stepBoq}
                  active={step === "boq"}
                  onClick={() => onStepChange("boq")}
                />
                <StepButton
                  number={2}
                  label={t.baseline.stepSchedule}
                  active={step === "schedule"}
                  onClick={() => onStepChange("schedule")}
                />
                {setupMode && (
                  <StepButton
                    number={3}
                    label={t.baseline.stepReview}
                    active={step === "review"}
                    onClick={() => onStepChange("review")}
                  />
                )}
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      <BoqImportDialog open={importing} onOpenChange={setImporting} projectId={projectId} />

      {shown === "boq" && (
        <BoqTab
          projectId={projectId}
          canEdit={canEdit}
          targetVersionId={target?.id}
          setupMode={setupMode}
          onContinue={() => onStepChange("schedule")}
        />
      )}
      {shown === "schedule" && (
        <ScheduleTab
          projectId={projectId}
          canEdit={canEdit}
          targetVersionId={target?.id}
          setupMode={setupMode}
          onReview={() => onStepChange("review")}
        />
      )}
      {shown === "review" && target && (
        <BaselineReview
          projectId={projectId}
          versionId={target.id}
          activeVersionNo={active?.versionNo ?? null}
          canEdit={canEdit}
          onEditBoq={() => onStepChange("boq")}
          onEditSchedule={() => onStepChange("schedule")}
          onActivated={() => onStepChange("boq")}
        />
      )}
    </div>
  );
}

function StepButton({
  number,
  label,
  active,
  onClick,
}: {
  number: number;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" onClick={onClick}>
      <span className="flex size-5 items-center justify-center rounded-full border text-[11px]">
        {number}
      </span>
      {label}
    </Button>
  );
}

function BaselineReview({
  projectId,
  versionId,
  activeVersionNo,
  canEdit,
  onEditBoq,
  onEditSchedule,
  onActivated,
}: {
  projectId: string;
  versionId: string;
  activeVersionNo: number | null;
  canEdit: boolean;
  onEditBoq: () => void;
  onEditSchedule: () => void;
  onActivated: () => void;
}) {
  const t = useT();
  const { money } = useFormat();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const overview = useQuery(trpc.boq.overview.queryOptions({ projectId, versionId }));
  const report = useQuery(trpc.progress.report.queryOptions({ projectId, versionId }));
  const activate = useMutation(trpc.boq.activate.mutationOptions());

  if (overview.isPending || report.isPending) return <Skeleton className="h-64 w-full" />;
  if (overview.isError || report.isError) {
    return (
      <QueryError
        error={overview.error ?? report.error}
        onRetry={() => void Promise.all([overview.refetch(), report.refetch()])}
      />
    );
  }
  const version = overview.data?.version;
  const items = overview.data?.items ?? [];
  const periods = report.data?.periods ?? [];
  const rows = scheduleRows(items);
  const cells = distributionMap(report.data?.distribution ?? []);
  const weightTotal = totalLeafWeight(items);
  const contractTotal = buildSections(items).reduce(
    (total, section) => total + sectionAmount(section),
    0,
  );
  const incompleteRows = rows.filter((row) => {
    const total = periods.reduce(
      (sum, period) => sum + (cells.get(`${row.leaf.id}|${period.id}`) ?? 0),
      0,
    );
    return Math.abs(total - 100) > ROW_TOLERANCE;
  }).length;
  const weightsReady = Math.abs(weightTotal - 100) <= ROW_TOLERANCE;
  const ready = rows.length > 0 && weightsReady && periods.length > 0 && incompleteRows === 0;

  async function activateBaseline() {
    try {
      await activate.mutateAsync({ versionId });
      await queryClient.invalidateQueries(trpc.boq.pathFilter());
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.schedule.pathFilter());
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      setConfirming(false);
      onActivated();
      toast.success(t.baseline.activated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t.baseline.reviewTitle}</CardTitle>
          <CardDescription>{t.baseline.reviewHint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ReviewCheck
              ready={rows.length > 0}
              label={t.baseline.pricedLines}
              value={interpolate(t.baseline.lineCount, { count: rows.length })}
            />
            <ReviewCheck
              ready={weightsReady}
              label={t.boq.weightTotal}
              value={`${weightTotal.toFixed(2)}%`}
            />
            <ReviewCheck
              ready={periods.length > 0}
              label={t.baseline.reportingPeriods}
              value={interpolate(t.baseline.periodCount, { count: periods.length })}
            />
            <ReviewCheck
              ready={incompleteRows === 0 && rows.length > 0}
              label={t.baseline.scheduleRows}
              value={
                incompleteRows === 0
                  ? t.baseline.allRowsComplete
                  : interpolate(t.baseline.rowsIncomplete, { count: incompleteRows })
              }
            />
          </div>
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">{t.boq.contractTotal}</p>
            <p className="text-xl font-semibold tabular-nums">{money(contractTotal)}</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onEditBoq}>
                {t.baseline.editBoq}
              </Button>
              <Button variant="outline" size="sm" onClick={onEditSchedule}>
                {t.baseline.editSchedule}
              </Button>
            </div>
            {canEdit && (
              <Button disabled={!ready || activate.isPending} onClick={() => setConfirming(true)}>
                <Lock />
                {activeVersionNo === null
                  ? t.baseline.activate
                  : interpolate(t.baseline.activateRevision, {
                      draft: version?.versionNo ?? "",
                      active: activeVersionNo,
                    })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.baseline.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {activeVersionNo === null
                ? t.baseline.confirmInitial
                : interpolate(t.baseline.confirmRevision, { number: activeVersionNo })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void activateBaseline()}>
              {t.baseline.confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReviewCheck({ ready, label, value }: { ready: boolean; label: string; value: string }) {
  const Icon = ready ? CheckCircle2 : CircleAlert;
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        {/* text-success, not a raw text-emerald-600 — the only Tailwind palette
            colour that had been left in the codebase, and the one green that
            did not follow the theme into dark mode. */}
        <Icon className={ready ? "size-4 text-success" : "size-4 text-destructive"} />
        <p className="text-sm font-medium">{label}</p>
      </div>
      <p className="mt-1 pl-6 text-xs text-muted-foreground">{value}</p>
    </div>
  );
}
