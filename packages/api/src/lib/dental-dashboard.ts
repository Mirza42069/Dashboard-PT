import { APPOINTMENT_STATUSES } from "@DashboardV2/db/schema";
import type {
  AppointmentStatus,
  PaymentStatus,
  TreatmentItemStatus,
  TreatmentPlanStatus,
} from "@DashboardV2/db/schema";

import { roundAmount, toAmount } from "./money";

type AppointmentMetric = {
  id: string;
  patientId: string;
  practitionerId: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
};

type TreatmentMetric = {
  fee: string | number;
  status: TreatmentItemStatus;
  planStatus: TreatmentPlanStatus;
  appointmentId: string | null;
  appointmentStartsAt: Date | null;
  completedAt: Date | null;
};

type PaymentMetric = {
  amount: string | number;
  status: PaymentStatus;
  paidAt: Date;
};

export type DentalDashboardInput = {
  todayStart: Date;
  todayEnd: Date;
  monthStart: Date;
  monthEnd: Date;
  patients: { createdAt: Date }[];
  practitioners: { id: string }[];
  appointments: AppointmentMetric[];
  treatmentItems: TreatmentMetric[];
  payments: PaymentMetric[];
  patientsWithAlerts: ReadonlySet<string>;
};

function inRange(value: Date, start: Date, end: Date) {
  return value >= start && value < end;
}

export function calculateDentalDashboard(input: DentalDashboardInput) {
  const today = input.appointments.filter((row) =>
    inRange(row.startsAt, input.todayStart, input.todayEnd),
  );
  const appointmentStatuses = Object.fromEntries(
    APPOINTMENT_STATUSES.map((status) => [
      status,
      today.filter((row) => row.status === status).length,
    ]),
  ) as Record<AppointmentStatus, number>;

  const monthlyPlannedProduction = input.treatmentItems
    .filter(
      (row) =>
        row.status !== "cancelled" &&
        row.planStatus !== "cancelled" &&
        row.appointmentStartsAt &&
        inRange(row.appointmentStartsAt, input.monthStart, input.monthEnd),
    )
    .reduce((total, row) => total + toAmount(row.fee), 0);
  const monthlyCompletedProduction = input.treatmentItems
    .filter(
      (row) =>
        row.status === "completed" &&
        row.completedAt &&
        inRange(row.completedAt, input.monthStart, input.monthEnd),
    )
    .reduce((total, row) => total + toAmount(row.fee), 0);

  const signedCollection = (row: PaymentMetric) =>
    row.status === "completed"
      ? toAmount(row.amount)
      : row.status === "refunded"
        ? -toAmount(row.amount)
        : 0;
  const monthlyCollections = input.payments
    .filter((row) => inRange(row.paidAt, input.monthStart, input.monthEnd))
    .reduce((total, row) => total + signedCollection(row), 0);
  const productionBalance = input.treatmentItems
    .filter(
      (row) =>
        row.status !== "cancelled" &&
        ["accepted", "in_progress", "completed"].includes(row.planStatus),
    )
    .reduce((total, row) => total + toAmount(row.fee), 0);
  const collectedBalance = input.payments.reduce(
    (total, row) => total + signedCollection(row),
    0,
  );

  const utilization = input.practitioners.map((practitioner) => {
    const bookedMinutes = today
      .filter(
        (row) =>
          row.practitionerId === practitioner.id &&
          row.status !== "cancelled" &&
          row.status !== "no_show",
      )
      .reduce(
        (total, row) => total + Math.max(0, (row.endsAt.getTime() - row.startsAt.getTime()) / 60000),
        0,
      );
    return {
      practitionerId: practitioner.id,
      bookedMinutes: Math.round(bookedMinutes),
      utilizationPercent: roundAmount((bookedMinutes / 480) * 100),
    };
  });

  return {
    todaysAppointmentCount: today.length,
    appointmentStatuses,
    newPatientsThisMonth: input.patients.filter((row) =>
      inRange(row.createdAt, input.monthStart, input.monthEnd),
    ).length,
    monthlyPlannedProduction: roundAmount(monthlyPlannedProduction),
    monthlyCompletedProduction: roundAmount(monthlyCompletedProduction),
    monthlyCollections: roundAmount(monthlyCollections),
    outstandingBalance: roundAmount(Math.max(0, productionBalance - collectedBalance)),
    utilization,
    attention: {
      unconfirmedToday: appointmentStatuses.scheduled,
      noShowsToday: appointmentStatuses.no_show,
      patientsWithMedicalAlertsToday: new Set(
        today
          .map((row) => row.patientId)
          .filter((patientId) => input.patientsWithAlerts.has(patientId)),
      ).size,
      unscheduledTreatmentItems: input.treatmentItems.filter(
        (row) =>
          !row.appointmentId &&
          (row.planStatus === "accepted" || row.planStatus === "in_progress") &&
          row.status !== "completed" &&
          row.status !== "cancelled",
      ).length,
    },
  };
}
