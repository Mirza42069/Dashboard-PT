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
import { Alert, AlertDescription, AlertTitle } from "@DashboardV2/ui/components/alert";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Label } from "@DashboardV2/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@DashboardV2/ui/components/select";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { CircleAlert, Lock, Send } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Hint } from "@/components/hint";
import { Meter } from "@/components/meter";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * Where one reporting period stands, and what can be done to it next.
 *
 * The panel is built around a single question — "is this week's report done,
 * and whose desk is it on" — because that is the question the workflow exists
 * to answer and the one a spreadsheet cannot.
 *
 * Completeness is shown as *lines addressed*, not lines filled in. A line
 * explicitly marked "no progress this period" counts; a blank one does not. The
 * two look identical in a grid of numbers, which is exactly why the count is
 * here and why submission is refused until the difference has been resolved.
 *
 * Every consequential move goes through a confirmation, and the two that change
 * an agreed record — returning a report, reopening a locked period — cannot be
 * confirmed without a written reason. The reason is not decoration: it is what
 * the next person to open this period reads.
 */

/** Mirrors isEditable in packages/api/src/lib/progress-workflow.ts. */
const isEditableStatus = (status: PeriodStatus) =>
  status === "open" || status === "draft" || status === "returned";

type PeriodStatus =
  | "open"
  | "draft"
  | "submitted"
  | "reviewed"
  | "approved"
  | "locked"
  | "returned";

/** Transitions offered to the user, and what each needs before it can run. */
type Move = {
  to: PeriodStatus;
  label: string;
  confirmTitle: string;
  confirmBody: string;
  /** Prompts for a reason, and refuses to proceed without one. */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** An optional note that does not block the move. */
  noteLabel?: string;
  destructive?: boolean;
  toast: string;
};

export default function ReportingWorkflow({
  projectId,
  canEdit,
  canReview,
  canLock,
  selectedPeriodId,
  onSelectPeriod,
  onBeforeSubmit,
}: {
  projectId: string;
  canEdit: boolean;
  canReview: boolean;
  canLock: boolean;
  selectedPeriodId: string | null;
  onSelectPeriod: (periodId: string) => void;
  onBeforeSubmit?: () => Promise<boolean>;
}) {
  const t = useT();
  const { formatDateRange, formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<Move | null>(null);
  const [reason, setReason] = useState("");
  const [preparing, setPreparing] = useState(false);

  const statusQuery = useQuery(trpc.progress.periodStatus.queryOptions({ projectId }));
  const transition = useMutation(trpc.progress.transitionPeriod.mutationOptions());
  const markNoProgress = useMutation(trpc.progress.markNoProgress.mutationOptions());

  if (statusQuery.isPending) return <Skeleton className="h-40 w-full" />;
  if (statusQuery.isError) {
    return <QueryError error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />;
  }

  const periods = statusQuery.data ?? [];
  if (periods.length === 0) return null;

  // Default to the period the project is actually working on: the earliest one
  // that is not finished. Landing on period 1 of a job in its ninth month would
  // be technically correct and useless.
  const current =
    periods.find((period) => period.id === selectedPeriodId) ??
    periods.find((period) => period.status !== "approved" && period.status !== "locked") ??
    periods[periods.length - 1]!;

  const { completeness } = current;
  const addressed = completeness.reported + completeness.noProgress;
  const status = current.status as PeriodStatus;

  const moves: Move[] = [];
  if (canEdit && (status === "draft" || status === "returned")) {
    moves.push({
      to: "submitted",
      label: t.reporting.submit,
      confirmTitle: t.reporting.confirmSubmitTitle,
      confirmBody: t.reporting.confirmSubmitBody,
      toast: t.reporting.submitted,
    });
  }
  if (canReview && status === "submitted") {
    moves.push({
      to: "reviewed",
      label: t.reporting.markReviewed,
      confirmTitle: t.reporting.markReviewed,
      confirmBody: t.reporting.confirmReviewBody,
      noteLabel: t.reporting.reviewComment,
      toast: t.reporting.markReviewed,
    });
  }
  if (canReview && (status === "submitted" || status === "reviewed")) {
    moves.push({
      to: "approved",
      label: t.reporting.approve,
      confirmTitle: t.reporting.confirmApproveTitle,
      confirmBody: t.reporting.confirmApproveBody,
      noteLabel: t.reporting.reviewComment,
      toast: t.reporting.approved,
    });
    moves.push({
      to: "returned",
      label: t.reporting.returnReport,
      confirmTitle: t.reporting.returnReport,
      // Was confirmSubmitBody — "the figures are frozen while a reviewer reads
      // them", which describes submitting, the opposite of sending it back.
      confirmBody: t.reporting.confirmReturnBody,
      reasonLabel: t.reporting.returnReason,
      reasonPlaceholder: t.reporting.returnReasonPlaceholder,
      destructive: true,
      toast: t.reporting.returned,
    });
  }
  if (canLock && status === "approved") {
    moves.push({
      to: "locked",
      label: t.reporting.lock,
      confirmTitle: t.reporting.confirmLockTitle,
      confirmBody: t.reporting.confirmLockBody,
      toast: t.reporting.locked,
    });
  }
  if (canLock && (status === "approved" || status === "locked")) {
    moves.push({
      to: "draft",
      label: t.reporting.reopen,
      confirmTitle: t.reporting.confirmReopenTitle,
      confirmBody: t.reporting.confirmReopenBody,
      reasonLabel: t.reporting.reopenReason,
      reasonPlaceholder: t.reporting.returnReasonPlaceholder,
      destructive: true,
      toast: t.reporting.reopened,
    });
  }

  const needsReason = Boolean(pending?.reasonLabel);
  const canConfirm = !needsReason || reason.trim().length > 0;

  async function run(move: Move) {
    setPreparing(true);
    try {
      if (move.to === "submitted" && onBeforeSubmit && !(await onBeforeSubmit())) return;
      await transition.mutateAsync({
        periodId: current.id,
        to: move.to,
        comment: reason.trim() || undefined,
      });
      await queryClient.invalidateQueries(trpc.progress.pathFilter());
      await queryClient.invalidateQueries(trpc.project.pathFilter());
      toast.success(move.toast);
      setPending(null);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {t.reporting.title}
              <Hint text={t.reporting.description} />
              <StatusBadge kind="period" value={status} />
            </CardTitle>
          </div>

          <div className="space-y-1">
            <Label htmlFor="reporting-period" className="text-xs text-muted-foreground">
              {t.reporting.periodPicker}
            </Label>
            <Select
              items={periods.map((period) => ({
                value: period.id,
                label: `${period.periodIndex} · ${formatDateRange(period.startDate, period.endDate)}`,
              }))}
              value={current.id}
              onValueChange={(value) => value && onSelectPeriod(value)}
            >
              <SelectTrigger id="reporting-period" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {`${period.periodIndex} · ${formatDateRange(period.startDate, period.endDate)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/*
         * The returned comment sits at the top of the panel, above the figures
         * it refers to, rather than in a history drawer. A correction request
         * nobody reads is a report that comes back a second time.
         */}
        {status === "returned" && current.returnReason && (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>{t.reporting.returnedNotice}</AlertTitle>
            <AlertDescription>{current.returnReason}</AlertDescription>
          </Alert>
        )}

        {current.reviewComment && status !== "returned" && (
          <Alert>
            <AlertTitle>{t.reporting.reviewComment}</AlertTitle>
            <AlertDescription>{current.reviewComment}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{t.reporting.completeness}</span>
              <span className="font-medium tabular-nums">
                {interpolate(t.reporting.completenessOf, {
                  done: addressed,
                  total: completeness.total,
                })}
              </span>
            </div>
            <Meter
              value={addressed}
              max={completeness.total}
              label={
                completeness.missing === 0
                  ? t.reporting.allAddressed
                  : interpolate(t.reporting.missingLines, { count: completeness.missing })
              }
            />
            {completeness.missing > 0 && (
              <>
                <p className="text-xs text-muted-foreground">{t.reporting.missingHint}</p>
                {canEdit && isEditableStatus(status) && (
                  /*
                   * The realistic shape of the task: fill in what moved, then
                   * say once that the rest did not. It is still an explicit
                   * statement — recorded against the person who made it — which
                   * is what separates it from leaving the cells blank.
                   */
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={markNoProgress.isPending}
                    onClick={async () => {
                      try {
                        const result = await markNoProgress.mutateAsync({ periodId: current.id });
                        await queryClient.invalidateQueries(trpc.progress.pathFilter());
                        toast.success(
                          interpolate(t.reporting.noProgressMarked, { count: result.marked }),
                        );
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : t.common.somethingWentWrong,
                        );
                      }
                    }}
                  >
                    {interpolate(t.reporting.markNoProgressRemaining, {
                      count: completeness.missing,
                    })}
                  </Button>
                )}
              </>
            )}
            {completeness.noProgress > 0 && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {interpolate(t.reporting.noProgressMarked, { count: completeness.noProgress })}
              </p>
            )}
          </div>

          {/*
           * Who has touched this report, in the order it happened. A definition
           * list rather than prose: these are three facts with three labels, and
           * a screen reader reads the pairing.
           */}
          <dl className="space-y-1 text-xs">
            {current.submittedByName && (
              <ActorRow
                label={interpolate(t.reporting.submittedBy, { name: current.submittedByName })}
                at={formatDateTime(current.submittedAt)}
              />
            )}
            {current.reviewedByName && (
              <ActorRow
                label={interpolate(t.reporting.reviewedBy, { name: current.reviewedByName })}
                at={formatDateTime(current.reviewedAt)}
              />
            )}
            {current.approvedByName && (
              <ActorRow
                label={interpolate(t.reporting.approvedBy, { name: current.approvedByName })}
                at={formatDateTime(current.approvedAt)}
              />
            )}
            {!current.submittedByName && !current.approvedByName && (
              <p className="text-muted-foreground">{t.reporting.historyEmpty}</p>
            )}
          </dl>
        </div>

        {moves.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {moves.map((move) => (
              <Button
                key={move.to + move.label}
                size="sm"
                variant={move.destructive ? "outline" : move.to === "submitted" ? "default" : "secondary"}
                disabled={transition.isPending || preparing}
                onClick={() => {
                  setReason("");
                  setPending(move);
                }}
              >
                {move.to === "submitted" && <Send />}
                {move.to === "locked" && <Lock />}
                {move.destructive && <CircleAlert />}
                {move.label}
              </Button>
            ))}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) {
            setPending(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{pending?.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>

          {(pending?.reasonLabel || pending?.noteLabel) && (
            <div className="space-y-2">
              <Label htmlFor="transition-reason">{pending.reasonLabel ?? pending.noteLabel}</Label>
              <Textarea
                id="transition-reason"
                rows={3}
                value={reason}
                required={needsReason}
                aria-describedby={needsReason && !canConfirm ? "transition-reason-error" : undefined}
                placeholder={pending.reasonPlaceholder}
                onChange={(e) => setReason(e.target.value)}
              />
              {needsReason && !canConfirm && (
                <p id="transition-reason-error" role="status" className="text-xs text-destructive">
                  {pending.reasonPlaceholder}
                </p>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canConfirm || transition.isPending || preparing}
              onClick={(event) => {
                // The dialog closes on action by default; a blocked confirm has
                // to stop that or the reason field vanishes with the request.
                if (!canConfirm) {
                  event.preventDefault();
                  return;
                }
                if (pending) void run(pending);
              }}
            >
              {pending?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ActorRow({ label, at }: { label: string; at: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{at}</dd>
    </div>
  );
}
