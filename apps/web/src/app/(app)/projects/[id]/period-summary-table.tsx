"use client";

import { Download } from "@DashboardV2/ui/components/icons";
import type { PeriodSummary } from "@DashboardV2/api/lib/curves";
import { groupPeriodsByMonth } from "@DashboardV2/api/lib/periods";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";

import { BulkActionsBar } from "@/components/bulk-actions-bar";
import { SelectAllHead, SelectRowCell, ToolbarAction } from "@/components/table-selection";
import { plural } from "@/i18n";
import { useT } from "@/i18n/provider";
import { downloadBlob } from "@/lib/download-file";
import { toast } from "@/lib/toast";
import { useRowSelection } from "@/lib/use-row-selection";
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

  /**
   * These rows are derived figures — nothing here can be deleted or edited, so
   * the one thing a selection can usefully do is take the numbers somewhere
   * else. Built on the client from what is already on screen rather than
   * through the server's spreadsheet export: the figures are all here, and a
   * second export endpoint for a subset of one table is not worth its weight.
   */
  const selection = useRowSelection(summary, { getId: (row) => row.period.id });

  function exportSelected() {
    const header = [
      t.periodSummary.period,
      t.periodSummary.dates,
      t.periodSummary.plannedPeriod,
      t.periodSummary.actualPeriod,
      t.periodSummary.plannedCumulative,
      t.periodSummary.actualCumulative,
      t.periodSummary.deviationPeriod,
      t.periodSummary.deviationCumulative,
    ];
    const body = selection.selectedRows.map((row) => [
      String(row.period.periodIndex),
      formatDateRange(row.period.startDate, row.period.endDate),
      figure(row.plannedPeriod),
      figure(row.actualPeriod),
      figure(row.plannedCumulative),
      figure(row.actualCumulative),
      figure(row.deviationPeriod),
      figure(row.deviationCumulative),
    ]);
    const csv = [header, ...body]
      .map((cells) => cells.map(csvCell).join(","))
      .join("\r\n");
    // The BOM is what makes Excel read this as UTF-8 rather than as the local
    // codepage, which is where the month names would otherwise come apart.
    downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), "periods.csv");
    toast.success(plural(t.periodSummary.exportedToast, selection.selectedCount));
    selection.clear();
  }

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
                row.isCurrent ? "border-l-2 border-l-[var(--chart-1)] bg-accent/40" : ""
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
       * No overflow affordance, because there is no overflow: the table is
       * fitted to the card (scrollX={false} plus the shares below). What used
       * to live here was first a hand-rolled edge gradient and then the
       * primitive's table-scroll-shadows, both of them cues that columns had
       * been pushed off the side. Fitting removed the thing they pointed at.
       *
       * Below `sm` the stacked card list above is still the answer — eight
       * columns do not divide a phone into anything readable.
       */}
      {/* Below `sm` the card list is what renders, and it carries no
          checkboxes — so the toolbar is hidden there too rather than offering
          an action over a selection that cannot be made. */}
      <div className="hidden px-3 sm:block">
        <BulkActionsBar count={selection.selectedCount} onClear={selection.clear}>
          <ToolbarAction
            icon={<Download />}
            label={t.periodSummary.exportSelected}
            onClick={exportSelected}
          />
        </BulkActionsBar>
      </div>

      <div className="hidden sm:block">
          <Table id={id} scrollX={false} className="w-full table-fixed border-collapse">
            {/*
             * table-fixed plus explicit shares, so the eight columns divide
             * the card between them instead of each demanding its min-content
             * width. That min-content floor — set by the nowrap headers over
             * "Planned cumulative" and "Cumulative deviation" — is what used
             * to force this table wider than the screen.
             */}
            <colgroup>
              <col style={{ width: "5%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "15%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "12%" }} />
            </colgroup>
            <caption className="sr-only">
              {dataDate
                ? `${t.periodSummary.caption} ${t.periodSummary.dataDateIs} ${formatDate(dataDate)}.`
                : t.periodSummary.caption}
            </caption>

            <TableHeader>
              <TableRow>
                {/*
                 * Two header rows: the month band spans its run of periods, the
                 * row beneath names the six figures. `scope` is set on both so
                 * a screen reader associates a cell with "June" and with
                 * "Cumulative deviation", which is what makes the table
                 * navigable rather than a wall of numbers.
                 */}
                <SelectAllHead selection={selection} label={t.periodSummary.selectAllPeriods} />
                <TableHead className="whitespace-normal align-bottom">
                  {t.periodSummary.period}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom">{t.periodSummary.dates}</TableHead>
                <TableHead className="whitespace-normal align-bottom text-right">
                  {t.periodSummary.plannedPeriod}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom text-right">
                  {t.periodSummary.actualPeriod}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom text-right">
                  {t.periodSummary.plannedCumulative}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom text-right">
                  {t.periodSummary.actualCumulative}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom text-right">
                  {t.periodSummary.deviationPeriod}
                </TableHead>
                <TableHead className="whitespace-normal align-bottom pr-4 text-right">
                  {t.periodSummary.deviationCumulative}
                </TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {summary.map((row, index) => {
                const group = monthStart.get(index);
                const isLocked = row.period.status === "locked";

                return (
                  <TableRow
                    key={row.period.id}
                    className={
                      // The current period is marked by a rule down its left
                      // edge *and* by the word in the identity cell. The rule
                      // alone would be colour-only.
                      row.isCurrent
                        ? "bg-accent/40 [&>th:first-child]:border-l-2 [&>th:first-child]:border-l-[var(--chart-1)]"
                        : ""
                    }
                    aria-current={row.isCurrent ? "true" : undefined}
                    data-state={selection.isSelected(row.period.id) ? "selected" : undefined}
                  >
                    <SelectRowCell
                      selection={selection}
                      id={row.period.id}
                      name={String(row.period.periodIndex)}
                    />
                    <th
                      scope="row"
                      className="p-2 text-left align-middle font-normal"
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

                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatDateRange(row.period.startDate, row.period.endDate)}
                    </TableCell>

                    <Figure value={row.plannedPeriod} />
                    <Figure value={row.actualPeriod} />
                    <Figure value={row.plannedCumulative} emphasis />
                    <Figure value={row.actualCumulative} emphasis />
                    <Deviation value={row.deviationPeriod} />
                    <Deviation value={row.deviationCumulative} emphasis />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
      <TableCell className="text-right text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.periodSummary.notReported}</span>
      </TableCell>
    );
  }

  return (
    <TableCell
      className={`text-right tabular-nums ${emphasis ? "font-medium" : "text-muted-foreground"}`}
    >
      {value.toFixed(2)}
    </TableCell>
  );
}

/** Deviation, where the sign is the message. */
function Deviation({ value, emphasis }: { value: number | null; emphasis?: boolean }) {
  const t = useT();

  if (value === null) {
    return (
      <TableCell className="text-right text-muted-foreground">
        <span aria-hidden>—</span>
        <span className="sr-only">{t.periodSummary.notReported}</span>
      </TableCell>
    );
  }

  const isBehind = value <= -NOISE;
  const isAhead = value >= NOISE;

  return (
    <TableCell
      className={[
        "text-right tabular-nums",
        emphasis ? "font-medium" : "",
        isBehind ? "text-destructive" : isAhead ? "text-success" : "text-muted-foreground",
      ].join(" ")}
    >
      {formatDeviationCell(value)}
      <span className="sr-only">
        {" "}
        {isBehind ? t.progress.behind : isAhead ? t.progress.ahead : t.progress.onTrack}
      </span>
    </TableCell>
  );
}

/** A blank stays blank in the export: it is not a reading of zero. */
function figure(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

/** Quotes only what needs it, and doubles any quote inside. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}
