import { describe, expect, test } from "bun:test";

import { calculateDentalDashboard } from "./dental-dashboard";

describe("dental dashboard calculation", () => {
  test("calculates production, net collections, outstanding and attention", () => {
    const result = calculateDentalDashboard({
      todayStart: new Date("2026-08-08T00:00:00Z"),
      todayEnd: new Date("2026-08-09T00:00:00Z"),
      monthStart: new Date("2026-08-01T00:00:00Z"),
      monthEnd: new Date("2026-09-01T00:00:00Z"),
      patients: [{ createdAt: new Date("2026-08-02T10:00:00Z") }],
      practitioners: [{ id: "practitioner-1" }],
      appointments: [
        {
          id: "appointment-1",
          patientId: "patient-1",
          practitionerId: "practitioner-1",
          startsAt: new Date("2026-08-08T09:00:00Z"),
          endsAt: new Date("2026-08-08T10:00:00Z"),
          status: "scheduled",
        },
      ],
      treatmentItems: [
        {
          fee: "300.00",
          status: "scheduled",
          planStatus: "accepted",
          appointmentId: "appointment-1",
          appointmentStartsAt: new Date("2026-08-08T09:00:00Z"),
          completedAt: null,
        },
        {
          fee: "200.00",
          status: "completed",
          planStatus: "completed",
          appointmentId: null,
          appointmentStartsAt: null,
          completedAt: new Date("2026-08-07T09:00:00Z"),
        },
      ],
      payments: [
        { amount: "150.00", status: "completed", paidAt: new Date("2026-08-05T12:00:00Z") },
        { amount: "20.00", status: "refunded", paidAt: new Date("2026-08-06T12:00:00Z") },
      ],
      patientsWithAlerts: new Set(["patient-1"]),
    });

    expect(result.todaysAppointmentCount).toBe(1);
    expect(result.newPatientsThisMonth).toBe(1);
    expect(result.monthlyPlannedProduction).toBe(300);
    expect(result.monthlyCompletedProduction).toBe(200);
    expect(result.monthlyCollections).toBe(130);
    expect(result.outstandingBalance).toBe(370);
    expect(result.utilization[0]).toEqual({
      practitionerId: "practitioner-1",
      bookedMinutes: 60,
      utilizationPercent: 12.5,
    });
    expect(result.attention).toEqual({
      unconfirmedToday: 1,
      noShowsToday: 0,
      patientsWithMedicalAlertsToday: 1,
      unscheduledTreatmentItems: 0,
    });
  });
});
