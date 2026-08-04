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
import { Checkbox } from "@DashboardV2/ui/components/checkbox";
import { Input } from "@DashboardV2/ui/components/input";
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
import { ArrowLeft, CircleAlert, Plus, Save, Trash2 } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

/**
 * One day's site report.
 *
 * Everything is optional. A report filed at six on a wet Tuesday carrying the
 * weather, a headcount and one line about what stopped is a genuinely useful
 * record; a form that demands eight paragraphs gets eight paragraphs of "N/A"
 * and teaches people that the form is a chore rather than a record.
 *
 * The three list sections are edited as rows and saved wholesale, which is why
 * they are held as local state and written on Save rather than per-keystroke:
 * a site engineer on a phone with intermittent signal wants one deliberate save
 * they can watch succeed, not thirty silent writes that may or may not have
 * landed.
 *
 * Layout is single-column and stays that way on desktop. This is a form filled
 * in top to bottom on a phone at the end of a shift, and columns would only
 * make the reading order ambiguous.
 */

type Manpower = { trade: string; headcount: string; hours: string; note: string };
type Equipment = { name: string; quantity: string; hoursUsed: string; idle: boolean; note: string };
type Delivery = {
  material: string;
  quantity: string;
  unit: string;
  supplier: string;
  reference: string;
  note: string;
};

type DailyStatus = "draft" | "submitted" | "reviewed" | "approved" | "returned";

const isEditableStatus = (status: DailyStatus) => status === "draft" || status === "returned";

const number = (value: string) => {
  const parsed = Number(value.trim());
  return value.trim() === "" || !Number.isFinite(parsed) ? null : parsed;
};

export default function DailyReportForm({
  reportId,
  canEdit,
  canReview,
  canLock,
  onBack,
}: {
  reportId: string;
  canEdit: boolean;
  canReview: boolean;
  canLock: boolean;
  onBack: () => void;
}) {
  const t = useT();
  const { formatDate, formatDateTime } = useFormat();
  const queryClient = useQueryClient();

  const query = useQuery(trpc.dailyReport.get.queryOptions({ id: reportId }));
  const save = useMutation(trpc.dailyReport.save.mutationOptions());
  const transition = useMutation(trpc.dailyReport.transition.mutationOptions());
  const remove = useMutation(trpc.dailyReport.delete.mutationOptions());

  /**
   * Loaded once into local state, keyed on the report id. Re-seeding on every
   * refetch would discard whatever the user was mid-way through typing.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [narrative, setNarrative] = useState({
    weather: "",
    weatherNote: "",
    rainfallHours: "",
    workPerformed: "",
    delays: "",
    safetyObservations: "",
    qualityObservations: "",
    visitors: "",
    notes: "",
  });
  const [manpower, setManpower] = useState<Manpower[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [confirming, setConfirming] = useState<null | { to: DailyStatus; label: string; body: string; needsReason: boolean; toast: string }>(null);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError) {
    return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  if (!data) return null;

  const { report } = data;
  const status = report.status as DailyStatus;
  const editable =
    canEdit && isEditableStatus(status) && !save.isPending && !transition.isPending;

  if (loadedFor !== reportId) {
    setLoadedFor(reportId);
    setNarrative({
      weather: report.weather ?? "",
      weatherNote: report.weatherNote ?? "",
      rainfallHours: report.rainfallHours === null ? "" : String(report.rainfallHours),
      workPerformed: report.workPerformed ?? "",
      delays: report.delays ?? "",
      safetyObservations: report.safetyObservations ?? "",
      qualityObservations: report.qualityObservations ?? "",
      visitors: report.visitors ?? "",
      notes: report.notes ?? "",
    });
    setManpower(
      data.manpower.map((row) => ({
        trade: row.trade,
        headcount: String(row.headcount),
        hours: row.hours === null ? "" : String(row.hours),
        note: row.note ?? "",
      })),
    );
    setEquipment(
      data.equipment.map((row) => ({
        name: row.name,
        quantity: String(row.quantity),
        hoursUsed: row.hoursUsed === null ? "" : String(row.hoursUsed),
        idle: row.idle,
        note: row.note ?? "",
      })),
    );
    setDeliveries(
      data.deliveries.map((row) => ({
        material: row.material,
        quantity: row.quantity === null ? "" : String(row.quantity),
        unit: row.unit ?? "",
        supplier: row.supplier ?? "",
        reference: row.reference ?? "",
        note: row.note ?? "",
      })),
    );
  }

  const weatherOptions = [
    { value: "clear", label: t.daily.weatherClear },
    { value: "cloudy", label: t.daily.weatherCloudy },
    { value: "light_rain", label: t.daily.weatherLightRain },
    { value: "heavy_rain", label: t.daily.weatherHeavyRain },
    { value: "storm", label: t.daily.weatherStorm },
    { value: "extreme_heat", label: t.daily.weatherExtremeHeat },
  ];

  const totalHeadcount = manpower.reduce((total, row) => total + (number(row.headcount) ?? 0), 0);

  async function refresh() {
    await queryClient.invalidateQueries(trpc.dailyReport.pathFilter());
  }

  async function persist(showSuccess = true) {
    try {
      await save.mutateAsync({
        id: reportId,
        weather: (narrative.weather || null) as never,
        weatherNote: narrative.weatherNote || null,
        rainfallHours: number(narrative.rainfallHours),
        workPerformed: narrative.workPerformed || null,
        delays: narrative.delays || null,
        safetyObservations: narrative.safetyObservations || null,
        qualityObservations: narrative.qualityObservations || null,
        visitors: narrative.visitors || null,
        notes: narrative.notes || null,
        manpower: manpower
          .filter((row) => row.trade.trim() !== "")
          .map((row) => ({
            trade: row.trade.trim(),
            headcount: number(row.headcount) ?? 0,
            hours: number(row.hours),
            note: row.note || null,
          })),
        equipment: equipment
          .filter((row) => row.name.trim() !== "")
          .map((row) => ({
            name: row.name.trim(),
            quantity: number(row.quantity) ?? 0,
            hoursUsed: number(row.hoursUsed),
            idle: row.idle,
            note: row.note || null,
          })),
        deliveries: deliveries
          .filter((row) => row.material.trim() !== "")
          .map((row) => ({
            material: row.material.trim(),
            quantity: number(row.quantity),
            unit: row.unit || null,
            supplier: row.supplier || null,
            reference: row.reference || null,
            note: row.note || null,
          })),
      });
      await refresh();
      if (showSuccess) toast.success(t.daily.saved);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.daily.saveFailed);
      return false;
    }
  }

  async function move(to: DailyStatus, successMessage: string) {
    try {
      // Submission freezes the report. Persist the form first so edits made
      // since the last explicit Save cannot disappear behind that transition.
      if (to === "submitted" && editable && !(await persist(false))) return;
      await transition.mutateAsync({ id: reportId, to, comment: reason.trim() || undefined });
      await refresh();
      toast.success(successMessage);
      setConfirming(null);
      setReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  const moves: { to: DailyStatus; label: string; body: string; needsReason: boolean; toast: string; destructive?: boolean }[] = [];
  if (canEdit && isEditableStatus(status)) {
    moves.push({
      to: "submitted",
      label: t.daily.submit,
      body: t.reporting.confirmSubmitBody,
      needsReason: false,
      toast: t.daily.submitted,
    });
  }
  if (canReview && status === "submitted") {
    moves.push({
      to: "reviewed",
      label: t.daily.markReviewed,
      body: t.daily.description,
      needsReason: false,
      toast: t.daily.markReviewed,
    });
  }
  if (canReview && (status === "submitted" || status === "reviewed")) {
    moves.push({
      to: "approved",
      label: t.daily.approve,
      body: t.reporting.confirmApproveBody,
      needsReason: false,
      toast: t.daily.approved,
    });
    moves.push({
      to: "returned",
      label: t.daily.returnReport,
      body: t.reporting.confirmSubmitBody,
      needsReason: true,
      toast: t.daily.returned,
      destructive: true,
    });
  }
  if (canLock && status === "approved") {
    moves.push({
      to: "draft",
      label: t.daily.reopen,
      body: t.reporting.confirmReopenBody,
      needsReason: true,
      toast: t.daily.reopened,
      destructive: true,
    });
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft />
                {t.daily.backToRegister}
              </Button>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {formatDate(report.reportDate)}
                <StatusBadge kind="dailyReport" value={status} />
              </CardTitle>
              <CardDescription>
                {t.daily.preparedBy}: {report.preparedByName}
                {report.submittedAt ? ` · ${formatDateTime(report.submittedAt)}` : ""}
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              {editable && (
                <Button disabled={save.isPending} onClick={() => void persist()}>
                  <Save />
                  {save.isPending ? t.common.saving : t.daily.save}
                </Button>
              )}
              {moves.map((item) => (
                <Button
                  key={item.to + item.label}
                  size="sm"
                  variant={item.destructive ? "outline" : "secondary"}
                  disabled={transition.isPending || save.isPending}
                  onClick={() => {
                    setReason("");
                    setConfirming(item);
                  }}
                >
                  {item.destructive && <CircleAlert />}
                  {item.label}
                </Button>
              ))}
              {canEdit && status === "draft" && (
                <Button variant="ghost" size="sm" onClick={() => setDeleting(true)}>
                  <Trash2 />
                  {t.daily.deleteReport}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {status === "returned" && report.returnReason && (
          <CardContent>
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>{t.daily.returnedNotice}</AlertTitle>
              <AlertDescription>{report.returnReason}</AlertDescription>
            </Alert>
          </CardContent>
        )}

        {!editable && (
          <CardContent>
            <p className="text-muted-foreground">
              {interpolate(t.daily.notEditable, {
                status: statusLabel(t, "dailyReport", status).toLowerCase(),
              })}
            </p>
          </CardContent>
        )}
      </Card>

      {/* ------------------------------------------------------------ weather */}
      <Card>
        <CardHeader>
          <CardTitle>{t.daily.weather}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="daily-weather">{t.daily.weather}</Label>
            <Select
              items={weatherOptions}
              value={narrative.weather || null}
              disabled={!editable}
              onValueChange={(value) =>
                setNarrative((current) => ({ ...current, weather: value ?? "" }))
              }
            >
              <SelectTrigger id="daily-weather" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {weatherOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-rain">{t.daily.rainfallHours}</Label>
            <Input
              id="daily-rain"
              type="number"
              min={0}
              max={24}
              step="any"
              inputMode="decimal"
              className="tabular-nums"
              value={narrative.rainfallHours}
              disabled={!editable}
              onChange={(e) =>
                setNarrative((current) => ({ ...current, rainfallHours: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="daily-weather-note">{t.daily.weatherNote}</Label>
            <Input
              id="daily-weather-note"
              value={narrative.weatherNote}
              disabled={!editable}
              onChange={(e) =>
                setNarrative((current) => ({ ...current, weatherNote: e.target.value }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* ---------------------------------------------------------- narrative */}
      <Card>
        <CardContent className="space-y-4 pt-4">
          {(
            [
              ["workPerformed", t.daily.workPerformed],
              ["delays", t.daily.delays],
              ["safetyObservations", t.daily.safety],
              ["qualityObservations", t.daily.quality],
              ["visitors", t.daily.visitors],
              ["notes", t.daily.notes],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="space-y-2">
              <Label htmlFor={`daily-${field}`}>{label}</Label>
              <Textarea
                id={`daily-${field}`}
                rows={3}
                value={narrative[field]}
                disabled={!editable}
                onChange={(e) =>
                  setNarrative((current) => ({ ...current, [field]: e.target.value }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ----------------------------------------------------------- manpower */}
      <RowSection
        title={t.daily.manpower}
        description={
          totalHeadcount > 0 ? `${t.daily.totalHeadcount}: ${totalHeadcount}` : undefined
        }
        editable={editable}
        rows={manpower}
        onAdd={() =>
          setManpower((current) => [...current, { trade: "", headcount: "", hours: "", note: "" }])
        }
        onRemove={(index) => setManpower((current) => current.filter((_, i) => i !== index))}
        nameOf={(row) => row.trade}
        columns={[
          { label: t.daily.trade, width: "min-w-40 flex-1" },
          { label: t.daily.people, width: "w-24" },
          { label: t.daily.hours, width: "w-24" },
          { label: t.daily.notes, width: "min-w-40 flex-1" },
        ]}
        render={(row, index) => (
          <>
            <Input
              aria-label={`${t.daily.trade} ${index + 1}`}
              className="min-w-40 flex-1"
              value={row.trade}
              disabled={!editable}
              onChange={(e) => patch(setManpower, index, { trade: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.people} ${index + 1}`}
              type="number"
              min={0}
              inputMode="numeric"
              className="w-24 text-right tabular-nums"
              value={row.headcount}
              disabled={!editable}
              onChange={(e) => patch(setManpower, index, { headcount: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.hours} ${index + 1}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="w-24 text-right tabular-nums"
              value={row.hours}
              disabled={!editable}
              onChange={(e) => patch(setManpower, index, { hours: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.notes} ${index + 1}`}
              className="min-w-40 flex-1"
              value={row.note}
              disabled={!editable}
              onChange={(e) => patch(setManpower, index, { note: e.target.value })}
            />
          </>
        )}
      />

      {/* ---------------------------------------------------------- equipment */}
      <RowSection
        title={t.daily.equipment}
        editable={editable}
        rows={equipment}
        onAdd={() =>
          setEquipment((current) => [
            ...current,
            { name: "", quantity: "1", hoursUsed: "", idle: false, note: "" },
          ])
        }
        onRemove={(index) => setEquipment((current) => current.filter((_, i) => i !== index))}
        nameOf={(row) => row.name}
        columns={[
          { label: t.daily.equipmentName, width: "min-w-40 flex-1" },
          { label: t.daily.quantity, width: "w-20" },
          { label: t.daily.hours, width: "w-24" },
          { label: t.daily.idle, width: "w-24" },
          { label: t.daily.notes, width: "min-w-40 flex-1" },
        ]}
        render={(row, index) => (
          <>
            <Input
              aria-label={`${t.daily.equipmentName} ${index + 1}`}
              className="min-w-40 flex-1"
              value={row.name}
              disabled={!editable}
              onChange={(e) => patch(setEquipment, index, { name: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.quantity} ${index + 1}`}
              type="number"
              min={0}
              inputMode="numeric"
              className="w-20 text-right tabular-nums"
              value={row.quantity}
              disabled={!editable}
              onChange={(e) => patch(setEquipment, index, { quantity: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.hours} ${index + 1}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="w-24 text-right tabular-nums"
              value={row.hoursUsed}
              disabled={!editable}
              onChange={(e) => patch(setEquipment, index, { hoursUsed: e.target.value })}
            />
            <label className="flex w-24 items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={row.idle}
                disabled={!editable}
                aria-label={`${t.daily.idle} ${index + 1}`}
                onCheckedChange={(checked) =>
                  patch(setEquipment, index, { idle: Boolean(checked) })
                }
              />
              {t.daily.idleHint}
            </label>
            <Input
              aria-label={`${t.daily.notes} ${index + 1}`}
              className="min-w-40 flex-1"
              value={row.note}
              disabled={!editable}
              onChange={(e) => patch(setEquipment, index, { note: e.target.value })}
            />
          </>
        )}
      />

      {/* --------------------------------------------------------- deliveries */}
      <RowSection
        title={t.daily.deliveries}
        editable={editable}
        rows={deliveries}
        onAdd={() =>
          setDeliveries((current) => [
            ...current,
            { material: "", quantity: "", unit: "", supplier: "", reference: "", note: "" },
          ])
        }
        onRemove={(index) => setDeliveries((current) => current.filter((_, i) => i !== index))}
        nameOf={(row) => row.material}
        columns={[
          { label: t.daily.material, width: "min-w-40 flex-1" },
          { label: t.daily.quantity, width: "w-24" },
          { label: t.daily.unit, width: "w-20" },
          { label: t.daily.supplier, width: "min-w-32 flex-1" },
          { label: t.daily.reference, width: "w-32" },
        ]}
        render={(row, index) => (
          <>
            <Input
              aria-label={`${t.daily.material} ${index + 1}`}
              className="min-w-40 flex-1"
              value={row.material}
              disabled={!editable}
              onChange={(e) => patch(setDeliveries, index, { material: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.quantity} ${index + 1}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              className="w-24 text-right tabular-nums"
              value={row.quantity}
              disabled={!editable}
              onChange={(e) => patch(setDeliveries, index, { quantity: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.unit} ${index + 1}`}
              className="w-20"
              value={row.unit}
              disabled={!editable}
              onChange={(e) => patch(setDeliveries, index, { unit: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.supplier} ${index + 1}`}
              className="min-w-32 flex-1"
              value={row.supplier}
              disabled={!editable}
              onChange={(e) => patch(setDeliveries, index, { supplier: e.target.value })}
            />
            <Input
              aria-label={`${t.daily.reference} ${index + 1}`}
              className="w-32"
              value={row.reference}
              disabled={!editable}
              onChange={(e) => patch(setDeliveries, index, { reference: e.target.value })}
            />
          </>
        )}
      />

      {/* ------------------------------------------------------------ history */}
      {data.events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.reporting.history}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-xs">
              {data.events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{event.actorName}</span>
                  <span className="text-muted-foreground">
                    {statusLabel(t, "dailyReport", event.fromStatus)} →{" "}
                    {statusLabel(t, "dailyReport", event.toStatus)}
                  </span>
                  <span className="ml-auto tabular-nums text-muted-foreground">
                    {formatDateTime(event.createdAt)}
                  </span>
                  {event.comment && <p className="w-full text-muted-foreground">{event.comment}</p>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(null);
            setReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.label}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          {confirming?.needsReason && (
            <div className="space-y-2">
              <Label htmlFor="daily-reason">{t.reporting.returnReason}</Label>
              <Textarea
                id="daily-reason"
                rows={3}
                required
                value={reason}
                placeholder={t.reporting.returnReasonPlaceholder}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                transition.isPending || (confirming?.needsReason && reason.trim().length === 0)
              }
              onClick={(event) => {
                if (confirming?.needsReason && reason.trim().length === 0) {
                  event.preventDefault();
                  return;
                }
                if (confirming) void move(confirming.to, confirming.toast);
              }}
            >
              {confirming?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.daily.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.daily.deleteBody, { date: formatDate(report.reportDate) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await remove.mutateAsync({ id: reportId });
                  await refresh();
                  toast.success(t.daily.deleted);
                  onBack();
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : t.common.somethingWentWrong,
                  );
                }
              }}
            >
              {t.daily.deleteReport}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Immutably updates one row of a list section. */
function patch<T>(
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  index: number,
  fields: Partial<T>,
) {
  setter((current) =>
    current.map((row, i) => (i === index ? { ...row, ...fields } : row)),
  );
}

/**
 * A repeating list of rows — manpower, plant, deliveries.
 *
 * Column headers are rendered once above the rows and every field carries its
 * own `aria-label` including the row number, because a flex row of bare inputs
 * is silent to a screen reader no matter how clear the header looks.
 */
function RowSection<T>({
  title,
  description,
  editable,
  rows,
  columns,
  render,
  onAdd,
  onRemove,
  nameOf,
}: {
  title: string;
  description?: string;
  editable: boolean;
  rows: T[];
  columns: { label: string; width: string }[];
  render: (row: T, index: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  nameOf: (row: T) => string;
}) {
  const t = useT();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {editable && (
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus />
              {t.daily.addRow}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{t.daily.noSections}</p>
        ) : (
          <>
            <div className="hidden gap-2 text-xs text-muted-foreground sm:flex">
              {columns.map((column) => (
                <span key={column.label} className={column.width}>
                  {column.label}
                </span>
              ))}
              {editable && <span className="w-9" />}
            </div>
            {rows.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                {render(row, index)}
                {editable && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={interpolate(t.daily.removeRow, {
                      name: nameOf(row) || String(index + 1),
                    })}
                    onClick={() => onRemove(index)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
