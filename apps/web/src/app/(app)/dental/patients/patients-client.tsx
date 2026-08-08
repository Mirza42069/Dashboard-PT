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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@DashboardV2/ui/components/sheet";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import { Textarea } from "@DashboardV2/ui/components/textarea";
import { DentalPatient, DentalPayment } from "@DashboardV2/ui/components/dental-icons";
import { Pencil, Plus, Trash2 } from "@DashboardV2/ui/components/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { QueryError } from "@/components/query-error";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { toast } from "@/lib/toast";
import { useDebounced } from "@/lib/use-debounced";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import {
  PageHeader,
  PAYMENT_METHODS,
  planStatusLabel,
  type PaymentMethod,
} from "../dental-ui";

type PatientSex = "female" | "male" | "other" | "unknown";

export default function PatientsClient({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);
  const debouncedSearch = useDebounced(search);
  const list = useQuery(
    trpc.dental.patients.list.queryOptions({
      search: debouncedSearch,
      includeArchived: false,
      limit: 100,
      offset: 0,
    }),
  );
  const archive = useMutation(trpc.dental.patients.archive.mutationOptions());

  async function refresh() {
    await queryClient.invalidateQueries(trpc.dental.pathFilter());
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    try {
      await archive.mutateAsync({ id: archiveTarget.id });
      setSelectedId(null);
      await refresh();
      toast.success(t.dental.archived);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    } finally {
      setArchiveTarget(null);
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title={t.dental.patientsTitle}
        action={canWrite ? <CreatePatientDialog onCreated={refresh} /> : undefined}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t.dental.searchPatients}
          aria-label={t.common.search}
          className="h-11 w-full sm:max-w-md"
        />
        {!list.isPending && (
          <p role="status" className="text-xs text-muted-foreground">
            {interpolate(t.dental.searchResults, { count: list.data?.total ?? 0 })}
          </p>
        )}
      </div>

      {list.isPending && <Skeleton className="h-72 w-full" />}
      {list.isError && <QueryError error={list.error} onRetry={() => void list.refetch()} />}
      {!list.isPending && !list.isError && list.data.patients.length === 0 && (
        <Card>
          <CardContent className="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
            <DentalPatient className="size-8 text-muted-foreground" />
            <p className="font-medium">
              {debouncedSearch ? t.dental.noPatientMatch : t.dental.noPatients}
            </p>
          </CardContent>
        </Card>
      )}
      {list.data && list.data.patients.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {list.data.patients.map((patient) => (
            <button
              key={patient.id}
              type="button"
              onClick={() => setSelectedId(patient.id)}
              className="min-h-24 rounded-lg bg-card p-4 text-start ring-1 ring-foreground/10 transition-colors hover:bg-muted/45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {patient.firstName} {patient.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{patient.recordNumber}</p>
                </div>
                {(patient.medicalAlerts || patient.allergies) && (
                  <Badge variant="destructive">{t.dental.medicalAlerts}</Badge>
                )}
              </div>
              <p className="mt-3 truncate text-xs text-muted-foreground">
                {[patient.phone, patient.email].filter(Boolean).join(" · ") || t.common.none}
              </p>
            </button>
          ))}
        </div>
      )}

      <PatientDetailSheet
        id={selectedId}
        canWrite={canWrite}
        onClose={() => setSelectedId(null)}
        onArchive={(target) => setArchiveTarget(target)}
      />

      <AlertDialog open={archiveTarget !== null} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.dental.archivePatient}</AlertDialogTitle>
            <AlertDialogDescription>
              {interpolate(t.dental.archiveConfirm, { name: archiveTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()}>{t.dental.archivePatient}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreatePatientDialog({ onCreated }: { onCreated: () => Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [sex, setSex] = useState<PatientSex>("unknown");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useMutation(trpc.dental.patients.create.mutationOptions());

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const required = ["recordNumber", "firstName", "lastName"];
    const nextErrors = Object.fromEntries(
      required.filter((name) => !String(values.get(name) ?? "").trim()).map((name) => [name, t.dental.requiredField]),
    );
    const email = String(values.get("email") ?? "").trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) nextErrors.email = t.dental.invalidEmail;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    const text = (name: string) => String(values.get(name) ?? "").trim() || null;
    try {
      await create.mutateAsync({
        recordNumber: text("recordNumber")!, firstName: text("firstName")!, lastName: text("lastName")!,
        preferredName: text("preferredName"), dateOfBirth: text("dateOfBirth"), sex,
        phone: text("phone"), email: text("email"), address: text("address"),
        emergencyContactName: text("emergencyContactName"), emergencyContactPhone: text("emergencyContactPhone"),
        medicalAlerts: text("medicalAlerts"), allergies: text("allergies"), medications: text("medications"), notes: text("notes"),
      });
      await onCreated();
      setOpen(false);
      setSex("unknown");
      form.reset();
      toast.success(t.dental.patientCreated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong);
    }
  }

  const field = (name: string) => ({
    "aria-invalid": errors[name] ? true as const : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: string) => errors[name] ? <p id={`${name}-error`} className="text-xs text-destructive">{errors[name]}</p> : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="h-11" />}><Plus />{t.dental.addPatient}</DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl" closeLabel={t.common.close}>
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader><DialogTitle>{t.dental.addPatient}</DialogTitle></DialogHeader>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold">{t.dental.patientDetails}</legend>
            <Field label={t.dental.recordNumber} name="recordNumber" error={error("recordNumber")}><Input name="recordNumber" {...field("recordNumber")} autoFocus /></Field>
            <Field label={t.dental.preferredName} name="preferredName"><Input name="preferredName" autoComplete="nickname" /></Field>
            <Field label={t.dental.firstName} name="firstName" error={error("firstName")}><Input name="firstName" {...field("firstName")} autoComplete="given-name" /></Field>
            <Field label={t.dental.lastName} name="lastName" error={error("lastName")}><Input name="lastName" {...field("lastName")} autoComplete="family-name" /></Field>
            <Field label={t.dental.dateOfBirth} name="dateOfBirth"><Input name="dateOfBirth" type="date" /></Field>
            <Field label={t.dental.sex} name="sex"><Select items={[]} value={sex} onValueChange={(value) => setSex((value ?? "unknown") as PatientSex)}><SelectTrigger id="sex" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="female">{t.dental.sexFemale}</SelectItem><SelectItem value="male">{t.dental.sexMale}</SelectItem><SelectItem value="other">{t.dental.sexOther}</SelectItem><SelectItem value="unknown">{t.dental.sexUnknown}</SelectItem></SelectContent></Select></Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold">{t.dental.contactDetails}</legend>
            <Field label={t.dental.phone} name="phone"><Input name="phone" type="tel" autoComplete="tel" /></Field>
            <Field label={t.dental.email} name="email" error={error("email")}><Input name="email" type="email" {...field("email")} autoComplete="email" /></Field>
            <Field label={t.dental.address} name="address" className="sm:col-span-2"><Textarea name="address" autoComplete="street-address" /></Field>
            <Field label={t.dental.emergencyContact} name="emergencyContactName"><Input name="emergencyContactName" /></Field>
            <Field label={t.dental.emergencyPhone} name="emergencyContactPhone"><Input name="emergencyContactPhone" type="tel" /></Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-3 text-sm font-semibold">{t.dental.clinicalContext}</legend>
            <Field label={t.dental.medicalAlerts} name="medicalAlerts"><Textarea name="medicalAlerts" /></Field>
            <Field label={t.dental.allergies} name="allergies"><Textarea name="allergies" /></Field>
            <Field label={t.dental.medications} name="medications"><Textarea name="medications" /></Field>
            <Field label={t.dental.notes} name="notes"><Textarea name="notes" /></Field>
          </fieldset>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? t.common.saving : t.common.save}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PatientDetailSheet({ id, canWrite, onClose, onArchive }: { id: string | null; canWrite: boolean; onClose: () => void; onArchive: (target: { id: string; name: string }) => void }) {
  const t = useT();
  const { money, formatDate, formatDateTime } = useFormat();
  const detail = useQuery({ ...trpc.dental.patients.get.queryOptions({ id: id ?? "" }), enabled: id !== null });
  const patient = detail.data?.patient;

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" closeLabel={t.common.close}>
        <SheetHeader>
          <SheetTitle>{patient ? `${patient.firstName} ${patient.lastName}` : t.dental.patientDetails}</SheetTitle>
          <SheetDescription>{patient?.recordNumber ?? t.dental.loading}</SheetDescription>
        </SheetHeader>
        {detail.isPending && <Skeleton className="mx-4 h-72" />}
        {detail.isError && <QueryError className="m-4" error={detail.error} onRetry={() => void detail.refetch()} />}
        {patient && detail.data && (
          <div className="space-y-6 px-4 pb-6">
            {(patient.medicalAlerts || patient.allergies) && <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"><p className="font-semibold text-destructive">{t.dental.medicalAlerts}</p>{patient.medicalAlerts && <p className="text-sm">{patient.medicalAlerts}</p>}{patient.allergies && <p className="text-sm"><strong>{t.dental.allergies}:</strong> {patient.allergies}</p>}</div>}
            <Section title={t.dental.contactDetails}><dl className="grid grid-cols-2 gap-3"><Info label={t.dental.phone} value={patient.phone} /><Info label={t.dental.email} value={patient.email} /><Info label={t.dental.dateOfBirth} value={formatDate(patient.dateOfBirth)} /><Info label={t.dental.address} value={patient.address} /></dl></Section>
            <Section title={t.dental.clinicalContext}><dl className="grid grid-cols-2 gap-3"><Info label={t.dental.medications} value={patient.medications} /><Info label={t.dental.notes} value={patient.notes} /></dl></Section>
            <Section title={t.dental.careHistory}>{detail.data.appointments.length === 0 && detail.data.treatmentPlans.length === 0 ? <p className="text-sm text-muted-foreground">{t.dental.noCareHistory}</p> : <div className="space-y-2">{detail.data.treatmentPlans.map((plan) => <div key={plan.id} className="rounded-md bg-muted/60 p-3"><p className="font-medium">{plan.title}</p><p className="text-xs text-muted-foreground">{planStatusLabel(plan.status, t)}</p></div>)}{detail.data.appointments.slice(0, 5).map((appointment) => <div key={appointment.id} className="flex justify-between gap-3 rounded-md bg-muted/60 p-3"><span>{appointment.appointmentType}</span><time className="text-muted-foreground">{formatDateTime(appointment.startsAt)}</time></div>)}</div>}</Section>
            <Section title={t.dental.paymentHistory}>{detail.data.payments.length === 0 ? <p className="text-sm text-muted-foreground">{t.dental.noPayments}</p> : <div className="space-y-2">{detail.data.payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/60 p-3"><span>{{ cash: t.dental.paymentCash, card: t.dental.paymentCard, bank_transfer: t.dental.paymentTransfer, insurance: t.dental.paymentInsurance, other: t.dental.paymentOther }[payment.method]}</span><span className="font-semibold tabular-nums">{money(payment.amount)}</span></div>)}</div>}</Section>
            {canWrite && <div className="flex flex-col gap-2 sm:flex-row"><EditPatientDialog patient={patient} onUpdated={() => detail.refetch()} /><PaymentDialog patientId={patient.id} onRecorded={() => detail.refetch()} /><Button variant="destructive" className="h-11" onClick={() => onArchive({ id: patient.id, name: `${patient.firstName} ${patient.lastName}` })}><Trash2 />{t.dental.archivePatient}</Button></div>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

type EditablePatient = {
  id: string;
  recordNumber: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  medicalAlerts: string | null;
  allergies: string | null;
  medications: string | null;
  notes: string | null;
};

function EditPatientDialog({ patient, onUpdated }: { patient: EditablePatient; onUpdated: () => Promise<unknown> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const update = useMutation(trpc.dental.patients.update.mutationOptions());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "").trim() || null;
    try {
      await update.mutateAsync({
        id: patient.id,
        recordNumber: text("recordNumber")!, firstName: text("firstName")!, lastName: text("lastName")!,
        phone: text("phone"), email: text("email"), address: text("address"),
        medicalAlerts: text("medicalAlerts"), allergies: text("allergies"),
        medications: text("medications"), notes: text("notes"),
      });
      await queryClient.invalidateQueries(trpc.dental.pathFilter());
      await onUpdated();
      setOpen(false);
      toast.success(t.dental.patientUpdated);
    } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); }
  }
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button variant="outline" className="h-11" />}><Pencil />{t.dental.editPatient}</DialogTrigger><DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-xl" closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle className="font-serif text-xl">{t.dental.editPatient}</DialogTitle></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label={t.dental.recordNumber} name="editRecordNumber"><Input id="editRecordNumber" name="recordNumber" defaultValue={patient.recordNumber} required /></Field><Field label={t.dental.phone} name="editPhone"><Input id="editPhone" name="phone" type="tel" defaultValue={patient.phone ?? ""} /></Field><Field label={t.dental.firstName} name="editFirstName"><Input id="editFirstName" name="firstName" defaultValue={patient.firstName} required /></Field><Field label={t.dental.lastName} name="editLastName"><Input id="editLastName" name="lastName" defaultValue={patient.lastName} required /></Field><Field label={t.dental.email} name="editEmail"><Input id="editEmail" name="email" type="email" defaultValue={patient.email ?? ""} /></Field><Field label={t.dental.address} name="editAddress"><Input id="editAddress" name="address" defaultValue={patient.address ?? ""} /></Field><Field label={t.dental.medicalAlerts} name="editMedicalAlerts"><Textarea id="editMedicalAlerts" name="medicalAlerts" defaultValue={patient.medicalAlerts ?? ""} /></Field><Field label={t.dental.allergies} name="editAllergies"><Textarea id="editAllergies" name="allergies" defaultValue={patient.allergies ?? ""} /></Field><Field label={t.dental.medications} name="editMedications"><Textarea id="editMedications" name="medications" defaultValue={patient.medications ?? ""} /></Field><Field label={t.dental.notes} name="editNotes"><Textarea id="editNotes" name="notes" defaultValue={patient.notes ?? ""} /></Field></div><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={update.isPending}>{update.isPending ? t.common.saving : t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function PaymentDialog({ patientId, onRecorded }: { patientId: string; onRecorded: () => Promise<unknown> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const create = useMutation(trpc.dental.payments.create.mutationOptions());
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      await create.mutateAsync({ patientId, amount: Number(values.get("amount")), method, reference: String(values.get("reference") ?? "").trim() || null });
      await queryClient.invalidateQueries(trpc.dental.pathFilter());
      await onRecorded();
      setOpen(false);
      toast.success(t.dental.paymentRecorded);
    } catch (error) { toast.error(error instanceof Error ? error.message : t.common.somethingWentWrong); }
  }
  const labels = { cash: t.dental.paymentCash, card: t.dental.paymentCard, bank_transfer: t.dental.paymentTransfer, insurance: t.dental.paymentInsurance, other: t.dental.paymentOther };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger render={<Button className="h-11" />}><DentalPayment />{t.dental.recordPayment}</DialogTrigger><DialogContent closeLabel={t.common.close}><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{t.dental.recordPayment}</DialogTitle></DialogHeader><Field label={t.dental.amount} name="amount"><Input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required /></Field><Field label={t.dental.paymentMethod} name="paymentMethod"><Select items={[]} value={method} onValueChange={(value) => setMethod((value ?? "cash") as PaymentMethod)}><SelectTrigger id="paymentMethod" className="h-11 w-full"><SelectValue /></SelectTrigger><SelectContent>{PAYMENT_METHODS.map((value) => <SelectItem key={value} value={value}>{labels[value]}</SelectItem>)}</SelectContent></Select></Field><Field label={t.dental.reference} name="reference"><Input name="reference" /></Field><DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.common.cancel}</Button><Button type="submit" disabled={create.isPending}>{t.common.save}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function Field({ label, name, className, error, children }: { label: string; name: string; className?: string; error?: React.ReactNode; children: React.ReactNode }) { return <div className={`space-y-1.5 ${className ?? ""}`}><Label htmlFor={name}>{label}</Label>{children}{error}</div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-3"><h2 className="text-sm font-semibold">{title}</h2>{children}</section>; }
function Info({ label, value }: { label: string; value: string | null | undefined }) { return <div className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 break-words text-sm">{value || "—"}</dd></div>; }
