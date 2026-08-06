"use client";

import type { DelayContributor } from "@DashboardV2/api/lib/curves";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@DashboardV2/ui/components/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@DashboardV2/ui/components/empty";
import { InfoIcon } from "@DashboardV2/ui/components/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@DashboardV2/ui/components/tooltip";

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
}: {
  contributors: DelayContributor<T>[];
  dataDate: string | null;
  /** The project-level deviation these rows add up to. Null when unreported. */
  totalDeviation: number | null;
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="rounded-full text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      aria-label={t.delay.help}
                    />
                  }
                >
                  <InfoIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{t.delay.help}</TooltipContent>
              </Tooltip>
            </CardTitle>
            <CardDescription>{t.delay.description}</CardDescription>
          </div>
          {/* The data date is stated, not implied — every figure below is as at
              this date and means nothing without it. */}
          <p className="text-xs text-muted-foreground tabular-nums">
            {t.exceptions.dataDate}: {formatDate(dataDate)}
          </p>
        </div>
      </CardHeader>

      <CardContent className="px-0">
        {dataDate === null ? (
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {t.delay.description}{" "}
                  {totalDeviation !== null &&
                    `${t.exceptions.variance}: ${totalDeviation.toFixed(2)}.`}
                </caption>
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      {t.delay.line}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.delay.weight}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.delay.plannedContribution}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.delay.actualContribution}
                    </th>
                    <th scope="col" className="px-2 py-2 text-right font-medium">
                      {t.delay.variance}
                    </th>
                    <th scope="col" className="min-w-40 px-4 py-2 text-left font-medium">
                      {t.delay.shareOfDelay}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t.delay.freshness}
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {shown.map((row) => (
                    <tr key={row.leaf.id} className="border-b last:border-0">
                      <th scope="row" className="max-w-72 px-4 py-2 text-left font-normal">
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

                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {row.weight.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                        {row.plannedContribution.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {row.actualContribution === null ? (
                          <>
                            <span aria-hidden>—</span>
                            <span className="sr-only">{t.delay.neverReported}</span>
                          </>
                        ) : (
                          row.actualContribution.toFixed(2)
                        )}
                      </td>
                      <td
                        className={`px-2 py-2 text-right font-medium tabular-nums ${
                          row.variance !== null && row.variance < -NOISE ? "text-destructive" : ""
                        }`}
                      >
                        {row.variance === null ? (
                          <span aria-hidden>—</span>
                        ) : (
                          // Sign always written, so "behind" survives greyscale.
                          `${row.variance < 0 ? "−" : "+"}${Math.abs(row.variance).toFixed(2)}`
                        )}
                      </td>

                      <td className="px-4 py-2">
                        {row.shareOfDelay === null ? (
                          <span className="text-xs text-muted-foreground">
                            {t.delay.neverReported}
                          </span>
                        ) : (
                          <Meter
                            value={row.shareOfDelay}
                            max={100}
                            segments={6}
                            label={`${row.shareOfDelay.toFixed(1)}%`}
                          />
                        )}
                      </td>

                      <td className="px-4 py-2 text-right text-xs text-muted-foreground tabular-nums">
                        {row.lastReadingIndex === null
                          ? t.delay.neverReported
                          : interpolate(t.delay.periodShort, { index: row.lastReadingIndex })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="px-4 pt-3 text-xs text-muted-foreground">{t.delay.correlationNote}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
