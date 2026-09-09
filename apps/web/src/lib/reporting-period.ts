export function selectedReportingPeriod<T extends { id: string; status: string }>(
  periods: readonly T[],
  selectedId: string | null,
): T | undefined {
  return periods.find((period) => period.id === selectedId) ??
    periods.find((period) => period.status !== "approved" && period.status !== "locked") ??
    periods.at(-1);
}
