"use client";

import { Badge } from "@DashboardV2/ui/components/badge";
import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@DashboardV2/ui/components/dialog";
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
import { DentalTreatment } from "@DashboardV2/ui/components/dental-icons";
import { Plus } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import {
  ITEM_STATUSES,
  PLAN_STATUSES,
  PageHeader,
  itemStatusLabel,
  planStatusLabel,
  type ItemStatus,
  type PlanStatus,
} from "../dental-ui";

type PatientOption = { id: string; firstName: string; lastName: string; recordNumber: string };

export default function TreatmentsClient({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const { money } = useFormat();
  const queryClient = useQueryClient();
  const treatments = useQuery(trpc.dental.treatments.list.queryOptions({}));
  const patients = useQuery(
    trpc.dental.patients.list.queryOptions({ search: "", includeArchived: false, limit: 100, offset: 0 }),
  );
  const updatePlan = useMutation(trpc.dental.treatments.update.mutationOptions());
  const updateItem = useMutation(trpc.dental.treatments.updateItem.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.dental.pathFilter());
  }
  async function setPlanStatus(id: string, status: PlanStatus) {
    try { await updatePlan.mutateAsync({ id, status }); await refresh(); toast.success(t.dental.planUpdated); }
    catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); }
  }
  async function setItemStatus(id: string, status: ItemStatus) {
    try { await updateItem.mutateAsync({ id, status }); await refresh(); toast.success(t.dental.procedureUpdated); }
    catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); }
  }

  const patientRows = patients.data?.patients ?? [];
  const patientNames = new Map(patientRows.map((patient) => [patient.id, `${patient.firstName} ${patient.lastName}`]));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader title={t.dental.treatmentsTitle} action={canWrite ? <CreatePlanDialog patients={patientRows} disabled={patientRows.length === 0} onCreated={refresh} /> : undefined} />
      {canWrite && !patients.isPending && patientRows.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t.dental.planNeedsPatient}</p>}
      {treatments.isPending && <Skeleton className="h-72 w-full" />}
      {treatments.isError && <QueryError error={treatments.error} onRetry={() => void treatments.refetch()} />}
      {treatments.data?.treatmentPlans.length === 0 && <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><DentalTreatment className="size-8 text-muted-foreground" /><p className="font-medium">{t.dental.noPlans}</p></CardContent></Card>}
      <div className="space-y-4">
        {treatments.data?.treatmentPlans.map((plan) => {
          const total = plan.items.reduce((sum, item) => sum + item.fee, 0);
          return <Card key={plan.id}>
            <CardHeader className="gap-3 sm:grid-cols-[1fr_auto]">
              <div><div className="flex flex-wrap items-center gap-2"><CardTitle>{plan.title}</CardTitle><Badge variant="secondary">{planStatusLabel(plan.status, t)}</Badge></div><CardDescription>{patientNames.get(plan.patientId) ?? t.dental.patient} · {money(total)}</CardDescription></div>
              {canWrite && <div className="flex flex-col gap-2 sm:flex-row"><Select items={PLAN_STATUSES.map((status) => ({ value: status, label: planStatusLabel(status, t) }))} value={plan.status} onValueChange={(value) => value && void setPlanStatus(plan.id, value as PlanStatus)} disabled={updatePlan.isPending}><SelectTrigger className="h-11 w-full sm:w-36" aria-label={t.common.edit}><SelectValue /></SelectTrigger><SelectContent>{PLAN_STATUSES.map((status) => <SelectItem key={status} value={status}>{planStatusLabel(status, t)}</SelectItem>)}</SelectContent></Select><CreateItemDialog planId={plan.id} patientId={plan.patientId} onCreated={refresh} /></div>}
            </CardHeader>
            <CardContent>
              {plan.items.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t.dental.noCareHistory}</p> : <div className="space-y-2">{plan.items.map((item) => <div key={item.id} className="grid gap-3 rounded-lg bg-muted/55 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.procedureCode} · {item.procedureName}</p><p className="text-xs text-muted-foreground">{item.toothNumber ? `${t.dental.toothNumber} ${item.toothNumber} · ` : ""}{money(item.fee)}</p></div><Badge variant="outline">{itemStatusLabel(item.status, t)}</Badge>{canWrite && <Select items={ITEM_STATUSES.map((status) => ({ value: status, label: itemStatusLabel(status, t) }))} value={item.status} onValueChange={(value) => value && void setItemStatus(item.id, value as ItemStatus)} disabled={updateItem.isPending}><SelectTrigger className="h-11 w-full sm:w-36" aria-label={t.common.edit}><SelectValue /></SelectTrigger><SelectContent>{ITEM_STATUSES.map((status) => <SelectItem key={status} value={status}>{itemStatusLabel(status, t)}</SelectItem>)}</SelectContent></Select>}</div>)}</div>}
            </CardContent>
          </Card>;
        })}
      </div>
    </div>
  );
}

function CreatePlanDialog({ patients, disabled, onCreated }: { patients: PatientOption[]; disabled: boolean; onCreated: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const create = useMutation(trpc.dental.treatments.create.mutationOptions());
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); if (!patientId) return; try { await create.mutateAsync({ patientId, title: String(data.get("title")), notes: String(data.get("notes") ?? "").trim() || null }); await onCreated(); setOpen(false); setPatientId(""); form.reset(); toast.success(t.dental.planCreated); } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); } }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger disabled={disabled} render={<Button className="h-11" />}><Plus />{t.dental.newPlan}</DialogTrigger><DialogContent closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle className="font-serif text-xl">{t.dental.newPlan}</DialogTitle></DialogHeader><Field label={t.dental.patient} id="planPatient"><Select items={[]} value={patientId} onValueChange={(value) => setPatientId(value ?? "")} required><SelectTrigger id="planPatient" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{patients.map((patient) => <SelectItem key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName} · {patient.recordNumber}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.planTitle} id="planTitle"><Input id="planTitle" name="title" required /></Field><Field label={t.dental.notes} id="planNotes"><Textarea id="planNotes" name="notes" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={create.isPending}>{t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function CreateItemDialog({ planId, patientId, onCreated }: { planId: string; patientId: string; onCreated: () => Promise<void> }) {
  const t = useT(); const [open, setOpen] = useState(false); const [status, setStatus] = useState<ItemStatus>("planned"); const [appointmentId, setAppointmentId] = useState("none"); const create = useMutation(trpc.dental.treatments.createItem.mutationOptions());
  const appointments = useQuery({ ...trpc.dental.appointments.list.queryOptions({ patientId, limit: 100, offset: 0 }), enabled: open });
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); try { await create.mutateAsync({ treatmentPlanId: planId, appointmentId: appointmentId === "none" ? null : appointmentId, procedureCode: String(data.get("procedureCode")), procedureName: String(data.get("procedureName")), toothNumber: String(data.get("toothNumber") ?? "").trim() || null, fee: Number(data.get("fee")), status, notes: String(data.get("notes") ?? "").trim() || null }); await onCreated(); setOpen(false); setStatus("planned"); setAppointmentId("none"); form.reset(); toast.success(t.dental.procedureAdded); } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); } }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline" className="h-11" />}><Plus />{t.dental.addProcedure}</DialogTrigger><DialogContent closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle className="font-serif text-xl">{t.dental.addProcedure}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label={t.dental.procedureCode} id="procedureCode"><Input id="procedureCode" name="procedureCode" required /></Field><Field label={t.dental.toothNumber} id="toothNumber"><Input id="toothNumber" name="toothNumber" /></Field><Field label={t.dental.procedureName} id="procedureName" className="sm:col-span-2"><Input id="procedureName" name="procedureName" required /></Field><Field label={t.dental.fee} id="fee"><Input id="fee" name="fee" type="number" min="0" step="0.01" inputMode="decimal" required /></Field><Field label={t.users.statusColumn} id="itemStatus"><Select items={[]} value={status} onValueChange={(value) => setStatus((value ?? "planned") as ItemStatus)}><SelectTrigger id="itemStatus" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{ITEM_STATUSES.map((value) => <SelectItem key={value} value={value}>{itemStatusLabel(value, t)}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.linkedAppointment} id="linkedAppointment" className="sm:col-span-2"><Select items={[]} value={appointmentId} onValueChange={(value) => setAppointmentId(value ?? "none")}><SelectTrigger id="linkedAppointment" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t.dental.noLinkedAppointment}</SelectItem>{appointments.data?.appointments.map(({ appointment }) => <SelectItem key={appointment.id} value={appointment.id}>{new Date(appointment.startsAt).toLocaleString()} · {appointment.appointmentType}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.notes} id="itemNotes" className="sm:col-span-2"><Textarea id="itemNotes" name="notes" /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={create.isPending}>{t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, id, className, children }: { label: string; id: string; className?: string; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className ?? ""}`}><Label htmlFor={id}>{label}</Label>{children}</div>; }
