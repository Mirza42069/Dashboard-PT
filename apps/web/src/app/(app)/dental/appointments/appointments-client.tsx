"use client";

import { Button } from "@DashboardV2/ui/components/button";
import { Card, CardContent } from "@DashboardV2/ui/components/card";
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
import { DentalAppointment } from "@DashboardV2/ui/components/dental-icons";
import { ChevronLeft, ChevronRight, Plus } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { trpc } from "@/utils/trpc";

import {
  APPOINTMENT_STATUSES,
  AppointmentStatusBadge,
  PageHeader,
  todayIso,
  type AppointmentStatus,
} from "../dental-ui";

function rangeFor(day: string) {
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export default function AppointmentsClient({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(todayIso);
  const appointments = useQuery(
    trpc.dental.appointments.list.queryOptions({ ...rangeFor(day), limit: 250, offset: 0 }),
  );
  const patients = useQuery(
    trpc.dental.patients.list.queryOptions({ search: "", includeArchived: false, limit: 100, offset: 0 }),
  );
  const practitioners = useQuery(trpc.dental.practitioners.list.queryOptions({ includeInactive: false }));
  const setStatus = useMutation(trpc.dental.appointments.setStatus.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.dental.pathFilter());
  }

  async function updateStatus(id: string, status: AppointmentStatus) {
    try {
      await setStatus.mutateAsync({ id, status });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  const statusLabels: Record<AppointmentStatus, string> = {
    scheduled: t.dental.statusScheduled, confirmed: t.dental.statusConfirmed,
    checked_in: t.dental.statusCheckedIn, in_progress: t.dental.statusInProgress,
    completed: t.dental.statusCompleted, cancelled: t.dental.statusCancelled,
    no_show: t.dental.statusNoShow,
  };
  const canSchedule = Boolean(patients.data?.patients.length && practitioners.data?.length);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title={t.dental.appointmentsTitle}
        action={canWrite ? <CreateAppointmentDialog day={day} patients={patients.data?.patients ?? []} practitioners={practitioners.data ?? []} disabled={!canSchedule} onCreated={refresh} /> : undefined}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium sm:max-w-48">{t.dental.chooseDate}<Input type="date" value={day} onChange={(event) => setDay(event.target.value)} className="h-11" /></label>
        <div className="flex gap-2">
          <Button className="size-11" variant="outline" size="icon" aria-label={t.dental.dayBefore} onClick={() => setDay(shiftDay(day, -1))}><ChevronLeft /></Button>
          <Button className="size-11" variant="outline" size="icon" aria-label={t.dental.dayAfter} onClick={() => setDay(shiftDay(day, 1))}><ChevronRight /></Button>
        </div>
      </div>

      {canWrite && !patients.isPending && !practitioners.isPending && !canSchedule && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t.dental.appointmentNeedsSetup}</p>}
      {appointments.isPending && <Skeleton className="h-72 w-full" />}
      {appointments.isError && <QueryError error={appointments.error} onRetry={() => void appointments.refetch()} />}
      {appointments.data && appointments.data.appointments.length === 0 && <Card><CardContent className="flex min-h-56 flex-col items-center justify-center gap-2 text-center"><DentalAppointment className="size-8 text-muted-foreground" /><p className="font-medium">{t.dental.noAppointments}</p></CardContent></Card>}
      {appointments.data && appointments.data.appointments.length > 0 && (
        <ol className="space-y-2">
          {appointments.data.appointments.map(({ appointment, patientFirstName, patientLastName, patientRecordNumber, practitionerName }) => {
            const patientName = `${patientFirstName} ${patientLastName}`;
            return <li key={appointment.id}><Card className="py-3"><CardContent className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
              <div><time className="text-base font-semibold tabular-nums">{new Date(appointment.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><p className="text-xs text-muted-foreground">{new Date(appointment.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p></div>
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{patientName}</p><AppointmentStatusBadge status={appointment.status} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{patientRecordNumber} · {appointment.appointmentType} · {practitionerName}</p>{appointment.reason && <p className="mt-1 text-xs">{appointment.reason}</p>}</div>
              {canWrite && <Select items={APPOINTMENT_STATUSES.map((value) => ({ value, label: statusLabels[value] }))} value={appointment.status} onValueChange={(value) => value && void updateStatus(appointment.id, value as AppointmentStatus)} disabled={setStatus.isPending}><SelectTrigger className="h-11 w-full sm:w-36" aria-label={interpolate(t.dental.updateStatus, { name: patientName })}><SelectValue /></SelectTrigger><SelectContent>{APPOINTMENT_STATUSES.map((status) => <SelectItem key={status} value={status}>{statusLabels[status]}</SelectItem>)}</SelectContent></Select>}
            </CardContent></Card></li>;
          })}
        </ol>
      )}
    </div>
  );
}

type PatientOption = { id: string; firstName: string; lastName: string; recordNumber: string };
type PractitionerOption = { id: string; displayName: string };

function CreateAppointmentDialog({ day, patients, practitioners, disabled, onCreated }: { day: string; patients: PatientOption[]; practitioners: PractitionerOption[]; disabled: boolean; onCreated: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [practitionerId, setPractitionerId] = useState("");
  const [formError, setFormError] = useState("");
  const create = useMutation(trpc.dental.appointments.create.mutationOptions());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const startsAt = new Date(String(data.get("startsAt")));
    const endsAt = new Date(String(data.get("endsAt")));
    if (!patientId) { setFormError(t.dental.selectPatient); return; }
    if (!practitionerId) { setFormError(t.dental.selectPractitioner); return; }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) { setFormError(t.dental.endAfterStart); return; }
    if (!data.get("appointmentType")) { form.reportValidity(); return; }
    setFormError("");
    try {
      await create.mutateAsync({ patientId, practitionerId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), appointmentType: String(data.get("appointmentType")), reason: String(data.get("reason") ?? "").trim() || null, notes: String(data.get("notes") ?? "").trim() || null });
      await onCreated(); setOpen(false); form.reset(); setPatientId(""); setPractitionerId(""); toast.success(t.dental.appointmentCreated);
    } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); }
  }
  const startDefault = `${day}T09:00`; const endDefault = `${day}T09:30`;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger disabled={disabled} render={<Button className="h-11" />}><Plus />{t.dental.newAppointment}</DialogTrigger><DialogContent className="sm:max-w-lg" closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle className="font-serif text-xl">{t.dental.newAppointment}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label={t.dental.patient} id="appointment-patient"><Select items={[]} value={patientId} onValueChange={(value) => { setPatientId(value ?? ""); setFormError(""); }} required><SelectTrigger id="appointment-patient" className="h-11 w-full" aria-invalid={!patientId && Boolean(formError)}><SelectValue placeholder={t.company.placeholder} /></SelectTrigger><SelectContent>{patients.map((patient) => <SelectItem key={patient.id} value={patient.id}>{patient.firstName} {patient.lastName} · {patient.recordNumber}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.practitioner} id="appointment-practitioner"><Select items={[]} value={practitionerId} onValueChange={(value) => { setPractitionerId(value ?? ""); setFormError(""); }} required><SelectTrigger id="appointment-practitioner" className="h-11 w-full" aria-invalid={!practitionerId && Boolean(formError)}><SelectValue /></SelectTrigger><SelectContent>{practitioners.map((practitioner) => <SelectItem key={practitioner.id} value={practitioner.id}>{practitioner.displayName}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.start} id="startsAt"><Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={startDefault} required /></Field><Field label={t.dental.end} id="endsAt"><Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={endDefault} required /></Field><Field label={t.dental.appointmentType} id="appointmentType" className="sm:col-span-2"><Input id="appointmentType" name="appointmentType" required /></Field><Field label={t.dental.reason} id="reason" className="sm:col-span-2"><Textarea id="reason" name="reason" /></Field><Field label={t.dental.notes} id="appointmentNotes" className="sm:col-span-2"><Textarea id="appointmentNotes" name="notes" /></Field></div>{formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? t.common.saving : t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, id, className, children }: { label: string; id: string; className?: string; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className ?? ""}`}><Label htmlFor={id}>{label}</Label>{children}</div>; }
