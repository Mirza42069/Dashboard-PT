/** Product-specific Hugeicons wrappers. Construction mappings remain in icons.tsx. */
import {
  Appointment02Icon,
  DentalCareIcon,
  Doctor02Icon,
  Medicine01Icon,
  PatientIcon,
  Payment02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ComponentProps } from "react";

type Glyph = ComponentProps<typeof HugeiconsIcon>["icon"];
export type DentalIconProps = Omit<ComponentProps<typeof HugeiconsIcon>, "icon">;

function icon(glyph: Glyph, name: string) {
  function Icon(props: DentalIconProps) {
    return <HugeiconsIcon icon={glyph} aria-hidden {...props} />;
  }
  Icon.displayName = name;
  return Icon;
}

export const DentalClinic = icon(DentalCareIcon, "DentalClinic");
export const DentalPatient = icon(PatientIcon, "DentalPatient");
export const DentalAppointment = icon(Appointment02Icon, "DentalAppointment");
export const DentalDoctor = icon(Doctor02Icon, "DentalDoctor");
export const DentalTreatment = icon(Medicine01Icon, "DentalTreatment");
export const DentalPayment = icon(Payment02Icon, "DentalPayment");
