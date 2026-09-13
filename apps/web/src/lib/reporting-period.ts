/** The reporting picker's "all periods" entry — an overview, not a real period. */
export const ALL_PERIODS = "all";

export function selectedReportingPeriod<T extends { id: string; status: string }>(
  periods: readonly T[],
  selectedId: string | null,
): T | undefined {
  return periods.find((period) => period.id === selectedId) ??
    periods.find((period) => period.status !== "approved") ??
    periods.at(-1);
}
