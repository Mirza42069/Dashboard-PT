import type { CompanyVertical } from "@DashboardV2/db/schema";

export function allowsCompanyVertical(
  actual: CompanyVertical,
  required: CompanyVertical,
): boolean {
  return actual === required;
}
