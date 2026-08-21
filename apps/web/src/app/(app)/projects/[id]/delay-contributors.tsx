"use client";

import type { ActualCurveSource, DelayContributor } from "@DashboardV2/api/lib/curves";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";

import { Hint } from "@/components/hint";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@DashboardV2/ui/components/table";

import { Meter } from "@/components/meter";
import { interpolate } from "@/i18n";
import { useT } from "@/i18n/provider";
import { useFormat } from "@/lib/use-format";

/**
 * Which lines account for the project's variance.
 *
 * The one number people actually act on is the last column: not "this line is
 * 40% done" but "this line is eleven points of the shortfall, and the next
 * three together are four". Ranking by that is what turns a deviation into a
 * conversation about specific work packages.
 *
 * Two honesty constraints are built into what this shows:
 *
 * - **It attributes, it does not explain.** The footnote says so in as many
 *   words. The data supports "the frame accounts for most of the gap"; it does
 *   not support "the frame caused the delay", and a table that implied the
 *   second would be read as the second.
 *
 * - **Unknown is not zero.** A line nobody has reported shows "never reported"
 *   rather than a variance equal to its whole plan. Those lines are ranked
 *   directly under the ones that are genuinely behind, because an unreported
 *   line is the other thing worth chasing — but it is labelled for what it is.
 */

const NOISE = 0.05;

export default function DelayContributors<T extends { id: string; code: string; description: string }>({
  contributors,
  dataDate,
  totalDeviation,
  actualSource,
}: {
  contributors: DelayContributor<T>[];
  dataDate: string | null;
  /** The project-level deviation these rows add up to. Null when unreported. */
  totalDeviation: number | null;
  actualSource: ActualCurveSource;
}) {
  const t = useT();
  const { formatDate } = useFormat();

  const behind = contributors.filter((row) => row.variance !== null && row.variance < -NOISE);
  const unreported = contributors.filter((row) => row.variance === null);
  const shown = [...behind, ...unreported].slice(0, 15);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-1.5">
              {t.delay.title}
              <Hint text={t.delay.help} />
            </CardTitle>
          </div>
          {/* The data date is stated, not implied — every figure below is as at
              this date and means nothing without it. */}
          <p className="text-xs text-muted-foreground tabular-nums">
            {t.exceptions.dataDate}: {formatDate(dataDate)}
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-0">
        {actualSource === "imported" ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t.delay.importedSnapshot}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : dataDate === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t.delay.noData}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : shown.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.delay.empty}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table>
                <caption className="sr-only">
                  {t.delay.description}{" "}
                  {totalDeviation !== null &&
                    `${t.exceptions.variance}: ${totalDeviation.toFixed(2)}.`}
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{t.delay.line}</TableHead>
                    <TableHead className="text-right">{t.delay.weight}</TableHead>
                    <TableHead className="text-right">{t.delay.plannedContribution}</TableHead>
                    <TableHead className="text-right">{t.delay.actualContribution}</TableHead>
                    <TableHead className="text-right">{t.delay.variance}</TableHead>
                    <TableHead className="min-w-40">{t.delay.shareOfDelay}</TableHead>
                    <TableHead className="pr-4 text-right">{t.delay.freshness}</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {shown.map((row) => (
                    <TableRow key={row.leaf.id}>
                      {/* A <th scope="row">, not a TableCell: the line
                          description is what names the row, and a <td> here
                          would leave every figure beside it unlabelled to a
                          screen reader. It carries TableCell's own classes so
                          it still lines up with the columns around it. */}
                      <th
                        scope="row"
                        className="max-w-72 p-2 pl-4 text-left align-middle font-normal"
                      >
                        <span className="block truncate" title={`${row.leaf.code} ${row.leaf.description}`}>
                          <span className="font-mono text-xs text-muted-foreground">
                            {row.leaf.code}
                          </span>{" "}
                          {row.leaf.description}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.section}
                        </span>
                      </th>

                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.weight.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {row.plannedContribution.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.actualContribution === null ? (
                          <>
                            <span aria-hidden>—</span>
                            <span className="sr-only">{t.delay.neverReported}</span>
                          </>
                        ) : (
                          row.actualContribution.toFixed(2)
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          row.variance !== null && row.variance < -NOISE ? "text-destructive" : ""
                        }`}
                      >
                        {row.variance === null ? (
                          <span aria-hidden>—</span>
                        ) : (
                          // Sign always written, so "behind" survives greyscale.
                          `${row.variance < 0 ? "−" : "+"}${Math.abs(row.variance).toFixed(2)}`
                        )}
                      </TableCell>

                      <TableCell>
                        {row.shareOfDelay === null ? (
                          <span className="text-xs text-muted-foreground">
                            {t.delay.neverReported}
                          </span>
                        ) : (
                          // Not the progress ramp: a big share of the delay is the
                          // worst row on this table, and the progress bands would
                          // paint it green. One hue, magnitude only.
                          <Meter
                            value={row.shareOfDelay}
                            max={100}
                            segments={6}
                            tone="magnitude"
                            label={`${row.shareOfDelay.toFixed(1)}%`}
                          />
                        )}
                      </TableCell>

                      <TableCell className="pr-4 text-right text-xs text-muted-foreground tabular-nums">
                        {row.lastReadingIndex === null
                          ? t.delay.neverReported
                          : interpolate(t.delay.periodShort, { index: row.lastReadingIndex })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
            </Table>

            <p className="px-4 pt-3 text-xs text-muted-foreground">{t.delay.correlationNote}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
