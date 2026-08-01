"use client";

import type { PeriodSummary } from "@DashboardV2/api/lib/curves";
import { groupPeriodsByMonth } from "@DashboardV2/api/lib/periods";

import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

/**
 * Plan versus actual, period by period — the block of summary rows that sits
 * under every contractor's S-curve sheet, turned on its side.
 *
 * The reference workbook lays these out as six rows across a very wide grid.
 * Here they are six columns down a scrollable table, which is the same
 * information in the shape a browser can actually deliver: a row per period
 * scrolls vertically on a phone, where a column per period would need a
 * horizontal drag per week.
 *
 * The table is also the S-curve's accessible equivalent. It is not a
 * "view as table" toggle hidden behind a button — the chart above is described
 * by it directly, so the figures are present for everyone, in the same place,
 * always.
 *
 * Three display rules carry the meaning:
 *
 * 1. **Missing is not zero.** A period with no reading renders an em dash with
 *    a spoken label, never 0.0. The workbook has the same gap after its last
 *    reported week, and filling it with zeros would draw a collapse that never
 *    happened on site.
 * 2. **Negative deviation is written, not coloured.** The figure carries a
 *    minus sign and the accounting parentheses the source sheet uses, so the
 *    number reads as behind in greyscale and to a screen reader. Colour is the
 *    third signal, not the only one.
 * 3. **Zero is zero.** `0.00`, plainly, so "nothing happened" and "nobody said"
 *    can never be confused.
 */

type SummaryPeriod = {
  id: string;
  periodIndex: number;
  label: string | null;
  startDate: string;
  endDate: string;
  status: string;
};

/** Below this, a difference is rounding rather than a schedule position. */
const NOISE = 0.05;

/**
 * `(1.10)` for behind, `1.10` for ahead — the convention on the sheet these
 * numbers come from, and one that survives being printed in black and white.
 */
function formatDeviationCell(value: number): string {
  const magnitude = Math.abs(value).toFixed(2);
  return value <= -NOISE ? `(${magnitude})` : magnitude;
}

export default function PeriodSummaryTable({
  id,
  summary,
  dataDate,
}: {
  /** So the chart can point at this table with aria-describedby. */
  id: string;
  summary: PeriodSummary<SummaryPeriod>[];
  dataDate: string | null;
}) {
  const t = useT();
  const { formatDateRange, formatMonthKey, formatDate } = useFormat();

  const months = groupPeriodsByMonth(summary.map((row) => row.period));
  // Which rows open a new month, so the month name is printed once per run
  // rather than repeated down every line.
  const monthStart = new Map(months.map((group) => [group.startIndex, group]));

  const dataDateIndex = summary.findIndex((row) => row.isCurrent);

  return (
    <div className="space-y-3">
      {/*
       * Phones get a card per period rather than a squeezed eight-column grid.
       * Same figures, same rules about blanks — but stacked, because a table
       * this wide on a 390px screen is a horizontal drag per week and nobody
       * reads a deviation that way.
       *
       * The table below is hidden here rather than reflowed so the desktop grid
       * stays a real table: it is what an expert user scans down a column of,
       * and turning it into stacked rows everywhere would cost that.
       */}
      <ul className="space-y-2 px-3 sm:hidden">
        {summary.map((row, index) => {
          const group = monthStart.get(index);
          return (
            <li
              key={row.period.id}
              className={`rounded-lg border p-3 ${
                row.isCurrent ? "border-l-2 border-l-[var(--chart-3)] bg-accent/40" : ""
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium tabular-nums">
                  {group && (
                    <span className="mr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {formatMonthKey(group.monthKey)}
                    </span>
                  )}
                  {row.period.periodIndex}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDateRange(row.period.startDate, row.period.endDate)}
                </span>
              </div>
              {row.isCurrent && (
                <p className="text-xs text-muted-foreground">{t.periodSummary.current}</p>
              )}
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <MobileFigure label={t.periodSummary.plannedCumulative} value={row.plannedCumulative} />
                <MobileFigure label={t.periodSummary.actualCumulative} value={row.actualCumulative} />
                <MobileFigure
                  label={t.periodSummary.deviationCumulative}
                  value={row.deviationCumulative}
                  deviation
                />
                <MobileFigure label={t.periodSummary.actualPeriod} value={row.actualPeriod} />
              </dl>
            </li>
          );
        })}
      </ul>

      {/*
       * The overflow affordance. `overflow-x-auto` alone gives a scrollbar that
       * macOS hides until it moves, so on a trackpad there is nothing to say
       * the table continues past the fold. The gradient is that cue, and it is
       * aria-hidden because it says nothing a keyboard or screen-reader user
       * does not already get from the table itself.
       */}
      <div className="relative hidden sm:block">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
        />
        <div className="overflow-x-auto">
          <table id={id} className="w-full min-w-3xl border-collapse text-sm">
            <caption className="sr-only">
              {dataDate
                ? `${t.periodSummary.caption} ${t.periodSummary.dataDateIs} ${formatDate(dataDate)}.`
                : t.periodSummary.caption}
            </caption>

            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {/*
                 * Two header rows: the month band spans its run of periods, the
                 * row beneath names the six figures. `scope` is set on both so
                 * a screen reader associates a cell with "June" and with
                 * "Cumulative deviation", which is what makes the table
                 * navigable rather than a wall of numbers.
                 */}
                <th scope="col" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                  {t.periodSummary.period}
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  {t.periodSummary.dates}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.plannedPeriod}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.actualPeriod}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.plannedCumulative}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.actualCumulative}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.deviationPeriod}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t.periodSummary.deviationCumulative}
                </th>
              </tr>
            </thead>

            <tbody>
              {summary.map((row, index) => {
                const group = monthStart.get(index);
                const isLocked = row.period.status === "locked";

                return (
                  <tr
                    key={row.period.id}
                    className={[
                      "border-b last:border-0",
                      // The current period is marked by a rule down its left
                      // edge *and* by the word in the identity cell. The rule
                      // alone would be colour-only.
                      row.isCurrent
                        ? "bg-accent/40 [&>th:first-child]:border-l-2 [&>th:first-child]:border-l-[var(--chart-3)]"
                        : "",
                    ].join(" ")}
                    aria-current={row.isCurrent ? "true" : undefined}
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal"
                    >
                      <span className="flex items-baseline gap-2">
                        {group && (
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {formatMonthKey(group.monthKey)}
                          </span>
                        )}
                        <span className="font-medium tabular-nums">{row.period.periodIndex}</span>
                      </span>
                      {(row.isCurrent || isLocked) && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {row.isCurrent ? t.periodSummary.current : t.progress.locked}
                        </span>
                      )}
                    </th>

                    <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground tabular-nums">
                      {formatDateRange(row.period.startDate, row.period.endDate)}
                    </td>

                    <Figure value={row.plannedPeriod} />
                    <Figure value={row.actualPeriod} />
                    <Figure value={row.plannedCumulative} emphasis />
                    <Figure value={row.actualCumulative} emphasis />
                    <Deviation value={row.deviationPeriod} />
                    <Deviation value={row.deviationCumulative} emphasis />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="px-3 text-xs text-muted-foreground">
        {dataDateIndex >= 0
          ? `${t.periodSummary.dataDateIs} ${formatDate(dataDate)}. ${t.periodSummary.missingNote}`
          : t.periodSummary.missingNote}
      </p>
    </div>
  );
}

/** One figure on a phone card. Same blank-versus-zero rule as the table. */
function MobileFigure({
  label,
  value,
  deviation,
}: {
  label: string;
  value: number | null;
  deviation?: boolean;
}) {
  const t = useT();
  const isBehind = value !== null && value <= -NOISE;
  const isAhead = value !== null && value >= NOISE;

  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={[
          "font-medium tabular-nums",
          deviation && isBehind ? "text-destructive" : "",
          deviation && isAhead ? "text-success" : "",
        ].join(" ")}
      >
        {value === null ? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">{t.periodSummary.notReported}</span>
          </>
        ) : deviation ? (
          formatDeviationCell(value)
        ) : (
          value.toFixed(2)
        )}
      </dd>
    </div>
  );
}

/** A plain percentage, or the "not reported" dash. */
function Figure({ value, emphasis }: { value: number | null; emphasis?: boolean }) {
  const t = useT();

  if (value === null) {
    return (
      <td className="px-3 py-1.5 text-right text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.periodSummary.notReported}</span>
      </td>
    );
  }

  return (
    <td
      className={`px-3 py-1.5 text-right tabular-nums ${emphasis ? "font-medium" : "text-muted-foreground"}`}
    >
      {value.toFixed(2)}
    </td>
  );
}

/** Deviation, where the sign is the message. */
function Deviation({ value, emphasis }: { value: number | null; emphasis?: boolean }) {
  const t = useT();

  if (value === null) {
    return (
      <td className="px-3 py-1.5 text-right text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.periodSummary.notReported}</span>
      </td>
    );
  }

  const isBehind = value <= -NOISE;
  const isAhead = value >= NOISE;

  return (
    <td
      className={[
        "px-3 py-1.5 text-right tabular-nums",
        emphasis ? "font-medium" : "",
        isBehind ? "text-destructive" : isAhead ? "text-success" : "text-muted-foreground",
      ].join(" ")}
    >
      {formatDeviationCell(value)}
      <span className="sr-only">
        {" "}
        {isBehind ? t.progress.behind : isAhead ? t.progress.ahead : t.progress.onTrack}
      </span>
    </td>
  );
}
