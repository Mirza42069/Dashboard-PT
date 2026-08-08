/**
 * Rerunnable dental MVP data.
 *
 * Run directly because the root package scripts are intentionally unchanged:
 * bun --env-file=apps/server/.env scripts/seed-dental.ts --company=DENTAL
 */
import { db } from "@DashboardV2/db";
import {
  company,
  dentalAppointment,
  dentalPatient,
  dentalPayment,
  dentalPractitioner,
  dentalTreatmentItem,
  dentalTreatmentPlan,
  user,
} from "@DashboardV2/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_COMPANY_CODE = "DENTAL";

function targetCompanyCode() {
  const flag = process.argv.find((arg) => arg.startsWith("--company="));
  return (flag ? flag.slice("--company=".length) : DEFAULT_COMPANY_CODE).toUpperCase();
}

function atUtc(dayOffset: number, hour: number, minute = 0) {
  const date = new Date();
  date.setUTCHours(hour, minute, 0, 0);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
}

async function main() {
  const code = targetCompanyCode();
  const [target] = await db.select().from(company).where(eq(company.code, code));
  if (!target) {
    throw new Error(`No company with code ${code}. Create a dental company first.`);
  }
  if (target.vertical !== "dental") {
    throw new Error(`Refusing to seed ${code}: its vertical is ${target.vertical}, not dental.`);
  }

  const key = `dental-seed-${target.id}`;
  const providerUsers = [
    {
      id: `${key}-user-dentist`,
      name: "Dr. Maya Chen",
      email: `maya.chen+${code.toLowerCase()}@dental-demo.invalid`,
      companyId: target.id,
      role: "user",
      emailVerified: true,
      mustChangePassword: true,
    },
    {
      id: `${key}-user-hygienist`,
      name: "Jordan Ellis, RDH",
      email: `jordan.ellis+${code.toLowerCase()}@dental-demo.invalid`,
      companyId: target.id,
      role: "user",
      emailVerified: true,
      mustChangePassword: true,
    },
  ];
  for (const row of providerUsers) {
    await db
      .insert(user)
      .values(row)
      .onConflictDoUpdate({
        target: user.id,
        set: { name: row.name, email: row.email, companyId: row.companyId, role: row.role },
      });
  }

  const practitioners = [
    {
      id: `${key}-practitioner-dentist`,
      companyId: target.id,
      userId: providerUsers[0]!.id,
      providerCode: "DDS-01",
      displayName: "Dr. Maya Chen",
      specialty: "General dentistry",
      phone: "+1 555 010 2001",
      color: "#2563eb",
      active: true,
    },
    {
      id: `${key}-practitioner-hygienist`,
      companyId: target.id,
      userId: providerUsers[1]!.id,
      providerCode: "RDH-01",
      displayName: "Jordan Ellis, RDH",
      specialty: "Dental hygiene",
      phone: "+1 555 010 2002",
      color: "#0d9488",
      active: true,
    },
  ];
  for (const row of practitioners) {
    await db
      .insert(dentalPractitioner)
      .values(row)
      .onConflictDoUpdate({
        target: dentalPractitioner.id,
        set: {
          providerCode: row.providerCode,
          displayName: row.displayName,
          specialty: row.specialty,
          phone: row.phone,
          color: row.color,
          active: row.active,
        },
      });
  }

  const patients = [
    {
      id: `${key}-patient-001`,
      companyId: target.id,
      recordNumber: "DEN-0001",
      firstName: "Avery",
      lastName: "Morgan",
      dateOfBirth: "1988-04-12",
      sex: "female" as const,
      phone: "+1 555 010 3101",
      email: "avery.morgan@example.invalid",
      medicalAlerts: "Penicillin allergy",
      allergies: "Penicillin",
      emergencyContactName: "Riley Morgan",
      emergencyContactPhone: "+1 555 010 3191",
    },
    {
      id: `${key}-patient-002`,
      companyId: target.id,
      recordNumber: "DEN-0002",
      firstName: "Noah",
      lastName: "Williams",
      dateOfBirth: "1976-11-03",
      sex: "male" as const,
      phone: "+1 555 010 3102",
      email: "noah.williams@example.invalid",
      medicalAlerts: "Type 2 diabetes; morning appointments preferred",
    },
    {
      id: `${key}-patient-003`,
      companyId: target.id,
      recordNumber: "DEN-0003",
      firstName: "Sofia",
      lastName: "Patel",
      dateOfBirth: "1995-07-21",
      sex: "female" as const,
      phone: "+1 555 010 3103",
      email: "sofia.patel@example.invalid",
    },
    {
      id: `${key}-patient-004`,
      companyId: target.id,
      recordNumber: "DEN-0004",
      firstName: "Liam",
      lastName: "Brooks",
      dateOfBirth: "2001-02-15",
      sex: "male" as const,
      phone: "+1 555 010 3104",
      notes: "Anxious patient; explain each step before treatment.",
    },
  ];
  for (const row of patients) {
    await db
      .insert(dentalPatient)
      .values(row)
      .onConflictDoUpdate({
        target: dentalPatient.id,
        set: {
          recordNumber: row.recordNumber,
          firstName: row.firstName,
          lastName: row.lastName,
          dateOfBirth: row.dateOfBirth,
          sex: row.sex,
          phone: row.phone,
          email: "email" in row ? row.email : null,
          medicalAlerts: "medicalAlerts" in row ? row.medicalAlerts : null,
          notes: "notes" in row ? row.notes : null,
        },
      });
  }

  const appointments = [
    {
      id: `${key}-appointment-001`,
      companyId: target.id,
      patientId: patients[0]!.id,
      practitionerId: practitioners[1]!.id,
      startsAt: atUtc(0, 8),
      endsAt: atUtc(0, 9),
      status: "confirmed" as const,
      appointmentType: "Hygiene recall",
      reason: "Six-month examination and cleaning",
    },
    {
      id: `${key}-appointment-002`,
      companyId: target.id,
      patientId: patients[1]!.id,
      practitionerId: practitioners[0]!.id,
      startsAt: atUtc(0, 9, 30),
      endsAt: atUtc(0, 10, 30),
      status: "checked_in" as const,
      appointmentType: "Restorative",
      reason: "Composite restoration tooth 19",
    },
    {
      id: `${key}-appointment-003`,
      companyId: target.id,
      patientId: patients[2]!.id,
      practitionerId: practitioners[0]!.id,
      startsAt: atUtc(0, 11),
      endsAt: atUtc(0, 11, 45),
      status: "scheduled" as const,
      appointmentType: "Consultation",
      reason: "Evaluate sensitivity",
    },
    {
      id: `${key}-appointment-004`,
      companyId: target.id,
      patientId: patients[3]!.id,
      practitionerId: practitioners[1]!.id,
      startsAt: atUtc(1, 14),
      endsAt: atUtc(1, 15),
      status: "confirmed" as const,
      appointmentType: "Hygiene recall",
      reason: "Routine cleaning",
    },
  ];
  for (const row of appointments) {
    await db
      .insert(dentalAppointment)
      .values(row)
      .onConflictDoUpdate({
        target: dentalAppointment.id,
        set: {
          patientId: row.patientId,
          practitionerId: row.practitionerId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          appointmentType: row.appointmentType,
          reason: row.reason,
        },
      });
  }

  const plans = [
    {
      id: `${key}-plan-001`,
      companyId: target.id,
      patientId: patients[1]!.id,
      title: "Lower left restorative care",
      status: "in_progress" as const,
      presentedAt: atUtc(-14, 10),
      acceptedAt: atUtc(-10, 10),
    },
    {
      id: `${key}-plan-002`,
      companyId: target.id,
      patientId: patients[2]!.id,
      title: "Sensitivity treatment",
      status: "accepted" as const,
      presentedAt: atUtc(-5, 10),
      acceptedAt: atUtc(-3, 10),
    },
  ];
  for (const row of plans) {
    await db
      .insert(dentalTreatmentPlan)
      .values(row)
      .onConflictDoUpdate({
        target: dentalTreatmentPlan.id,
        set: {
          patientId: row.patientId,
          title: row.title,
          status: row.status,
          presentedAt: row.presentedAt,
          acceptedAt: row.acceptedAt,
        },
      });
  }

  const items = [
    {
      id: `${key}-item-001`,
      companyId: target.id,
      treatmentPlanId: plans[0]!.id,
      appointmentId: appointments[1]!.id,
      procedureCode: "D2392",
      procedureName: "Posterior composite, two surfaces",
      toothNumber: "19",
      status: "scheduled" as const,
      fee: "285.00",
    },
    {
      id: `${key}-item-002`,
      companyId: target.id,
      treatmentPlanId: plans[0]!.id,
      appointmentId: null,
      procedureCode: "D2740",
      procedureName: "Ceramic crown",
      toothNumber: "18",
      status: "planned" as const,
      fee: "1250.00",
    },
    {
      id: `${key}-item-003`,
      companyId: target.id,
      treatmentPlanId: plans[1]!.id,
      appointmentId: appointments[2]!.id,
      procedureCode: "D9910",
      procedureName: "Desensitizing medicament",
      toothNumber: null,
      status: "scheduled" as const,
      fee: "95.00",
    },
    {
      id: `${key}-item-004`,
      companyId: target.id,
      treatmentPlanId: plans[0]!.id,
      appointmentId: null,
      procedureCode: "D0220",
      procedureName: "Periapical radiograph",
      toothNumber: "19",
      status: "completed" as const,
      fee: "35.00",
      completedAt: atUtc(-2, 10),
    },
  ];
  for (const row of items) {
    await db
      .insert(dentalTreatmentItem)
      .values(row)
      .onConflictDoUpdate({
        target: dentalTreatmentItem.id,
        set: {
          treatmentPlanId: row.treatmentPlanId,
          appointmentId: row.appointmentId,
          procedureCode: row.procedureCode,
          procedureName: row.procedureName,
          toothNumber: row.toothNumber,
          status: row.status,
          fee: row.fee,
          completedAt: "completedAt" in row ? row.completedAt : null,
        },
      });
  }

  const payments = [
    {
      id: `${key}-payment-001`,
      companyId: target.id,
      patientId: patients[1]!.id,
      treatmentPlanId: plans[0]!.id,
      appointmentId: appointments[1]!.id,
      amount: "200.00",
      status: "completed" as const,
      method: "card" as const,
      reference: "DEMO-RECEIPT-001",
      paidAt: atUtc(-2, 11),
      receivedById: providerUsers[0]!.id,
    },
    {
      id: `${key}-payment-002`,
      companyId: target.id,
      patientId: patients[2]!.id,
      treatmentPlanId: plans[1]!.id,
      appointmentId: null,
      amount: "50.00",
      status: "completed" as const,
      method: "cash" as const,
      reference: "DEMO-RECEIPT-002",
      paidAt: atUtc(-1, 15),
      receivedById: providerUsers[0]!.id,
    },
  ];
  for (const row of payments) {
    await db
      .insert(dentalPayment)
      .values(row)
      .onConflictDoUpdate({
        target: dentalPayment.id,
        set: {
          patientId: row.patientId,
          treatmentPlanId: row.treatmentPlanId,
          appointmentId: row.appointmentId,
          amount: row.amount,
          status: row.status,
          method: row.method,
          reference: row.reference,
          paidAt: row.paidAt,
          receivedById: row.receivedById,
        },
      });
  }

  console.log(
    `Seeded ${target.name}: ${practitioners.length} practitioners, ${patients.length} patients, ` +
      `${appointments.length} appointments, ${plans.length} plans and ${payments.length} payments.`,
  );
}

main().catch((error) => {
  console.error("Failed to seed dental data:", error instanceof Error ? error.message : error);
  process.exit(1);
});
