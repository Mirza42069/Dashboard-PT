"use client";

import { Button } from "@DashboardV2/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Input } from "@DashboardV2/ui/components/input";
import { Progress, ProgressLabel } from "@DashboardV2/ui/components/progress";
import { Skeleton } from "@DashboardV2/ui/components/skeleton";
import {
  DentalAppointment,
  DentalClinic,
  DentalDoctor,
  DentalPatient,
  DentalPayment,
  DentalTreatment,
} from "@DashboardV2/ui/components/dental-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { AppointmentStatusBadge, PageHeader, todayIso } from "./dental-ui";

export default function DentalDashboardClient() {
  const t = useT();
  const { moneyCompact } = useFormat();
  const [date, setDate] = useState(todayIso);
  const summary = useQuery(trpc.dental.dashboard.summary.queryOptions({ date }));

  if (summary.isPending) {
    return (
      <div className="space-y-5 p-4 md:p-6" aria-busy="true" aria-label={t.dental.loading}>
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (summary.isError) {
    return (
      <div className="grid min-h-full place-items-center p-4">
        <div role="alert" className="max-w-md space-y-4 text-center">
          <DentalClinic className="mx-auto size-9 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">{t.common.loadFailed}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{summary.error.message}</p>
          </div>
          <Button variant="outline" onClick={() => void summary.refetch()}>{t.common.retry}</Button>
        </div>
      </div>
    );
  }

  const data = summary.data;
  const attention = [
    { label: t.dental.unconfirmed, value: data.attention.unconfirmedToday },
    { label: t.dental.noShows, value: data.attention.noShowsToday },
    { label: t.dental.medicalAlertsToday, value: data.attention.patientsWithMedicalAlertsToday },
    { label: t.dental.unscheduledCare, value: data.attention.unscheduledTreatmentItems },
  ];
  const attentionTotal = attention.reduce((total, item) => total + item.value, 0);

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader
        title={t.dental.dashboardTitle}
        action={
          <label className="grid gap-1 text-xs font-medium">
            {t.dental.chooseDate}
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-11 w-full min-w-0 sm:w-44"
            />
          </label>
        }
      />

      <section aria-label={t.dental.thisMonth} className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric icon={DentalAppointment} label={t.dental.todaysAppointments} value={String(data.todaysAppointmentCount)} />
        <Metric icon={DentalPatient} label={t.dental.newPatients} value={String(data.newPatientsThisMonth)} />
        <Metric icon={DentalTreatment} label={t.dental.plannedProduction} value={moneyCompact(data.monthlyPlannedProduction)} detail={`${t.dental.completedProduction}: ${moneyCompact(data.monthlyCompletedProduction)}`} />
        <Metric icon={DentalPayment} label={t.dental.collections} value={moneyCompact(data.monthlyCollections)} />
        <Metric icon={DentalPayment} label={t.dental.outstanding} value={moneyCompact(data.outstandingBalance)} attention={data.outstandingBalance > 0} />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>{t.dental.todaySchedule}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.schedule.length === 0 ? (
              <Empty icon={DentalAppointment} text={t.dental.noSchedule} />
            ) : (
              <ol className="space-y-2">
                {data.schedule.map((item) => (
                  <li key={item.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-3 rounded-lg bg-muted/55 p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
                    <time className="text-sm font-semibold tabular-nums">
                      {new Date(item.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.patientFirstName} {item.patientLastName}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.appointmentType} · {item.practitionerName}</p>
                    </div>
                    <div className="col-start-2 sm:col-start-auto"><AppointmentStatusBadge status={item.status} /></div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card className={attentionTotal > 0 ? "border-destructive/40" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><DentalClinic className="size-4" />{t.dental.attention}</CardTitle>
          </CardHeader>
          <CardContent>
            {attentionTotal === 0 ? (
              <p className="py-5 text-sm text-muted-foreground">{t.dental.noAttention}</p>
            ) : (
              <dl className="space-y-2">
                {attention.filter((item) => item.value > 0).map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-4 rounded-md bg-card/70 px-3 py-2.5">
                    <dt className="text-sm">{item.label}</dt><dd className="font-semibold tabular-nums text-destructive">{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.dental.utilization}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.practitionerUtilization.length === 0 ? (
            <Empty icon={DentalDoctor} text={t.dental.noPractitioners} />
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {data.practitionerUtilization.map((item) => (
                <Progress key={item.practitionerId} value={Math.min(100, item.utilizationPercent)}>
                  <ProgressLabel className="font-medium">{item.practitionerName}</ProgressLabel>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {Math.round(item.utilizationPercent)}% · {item.bookedMinutes} min
                  </span>
                </Progress>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, attention }: { icon: typeof DentalClinic; label: string; value: string; detail?: string; attention?: boolean }) {
  return (
    <Card className={attention ? "border-destructive/40" : undefined}>
      <CardContent className="flex h-full flex-col justify-between gap-4">
        <div className="flex items-start justify-between gap-2"><p className="text-xs text-muted-foreground">{label}</p><Icon className="size-4 shrink-0 text-muted-foreground" /></div>
        <div><p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>
      </CardContent>
    </Card>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof DentalClinic; text: string }) {
  return <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"><Icon className="size-6" /><p>{text}</p></div>;
}
