"use client";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@DashboardV2/ui/components/chart";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";

import { useT } from "@/i18n/provider";

/**
 * Planned vs actual completion over the reporting periods — the S-curve.
 *
 * Three decisions worth keeping:
 *
 * - The actual series is drawn with `connectNulls` off. Periods after the last
 *   reading come through as null, so the line simply stops rather than running
 *   flat to the end of the contract. An unreported period should look unknown,
 *   not look like a fortnight of no work.
 *
 * - Planned is a dashed area, actual a solid line. The two series are told
 *   apart by shape as well as by hue, so the chart survives greyscale printing
 *   and the common colour deficiencies. The legend below is hand-drawn for the
 *   same reason: `ChartLegendContent` draws filled squares, which would state
 *   the hue and drop the shape — the half that does the work here.
 *
 * - The drawing itself is hidden from assistive technology and the figures are
 *   read from the summary table below instead, via `describedById`. An SVG of
 *   two polylines has no useful reading order; the table is the same data in a
 *   form that does.
 */

export type CurvePoint = {
  label: string;
  planned: number;
  actual: number | null;
};

export default function SCurveChart({
  data,
  /** id of the table carrying these figures — the chart's text equivalent. */
  describedById,
  /** Marks the data date: everything right of it is plan, not record. */
  dataDateLabel,
}: {
  data: CurvePoint[];
  describedById?: string;
  dataDateLabel?: string | null;
}) {
  const t = useT();

  const config = {
    planned: { label: t.progress.chartPlanned, color: "var(--chart-4)" },
    actual: { label: t.progress.chartActual, color: "var(--chart-1)" },
  } satisfies ChartConfig;

  return (
    <div role="img" aria-label={t.progress.chartLabel} aria-describedby={describedById}>
      {/* ChartContainer defaults to aspect-video; this chart is a fixed height
          beside a column of KPI tiles, so the aspect ratio has to be released. */}
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="planned-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-planned)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-planned)" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            minTickGap={12}
          />
          <YAxis
            domain={[0, 100]}
            tickFormatter={(value: number) => `${value}%`}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            width={48}
          />
          {/* A formatter replaces the whole tooltip row, swatch included, so
              the swatch is redrawn here. It buys the one thing the default
              cannot do: these are percentages to one decimal, not counts. */}
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name, item) => (
                  <>
                    <span
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ background: item.color }}
                    />
                    <div className="flex flex-1 items-center justify-between gap-3 leading-none">
                      <span className="text-muted-foreground">
                        {config[name as keyof typeof config]?.label ?? name}
                      </span>
                      <span className="font-mono font-medium tabular-nums text-foreground">
                        {typeof value === "number" ? `${value.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </>
                )}
              />
            }
          />

          {/*
           * The data date. Without it the actual line simply stops and reads as
           * a project that halted, rather than one whose reporting has caught
           * up to a particular Saturday. Drawn behind both series so it never
           * obscures a reading.
           */}
          {dataDateLabel && (
            <ReferenceLine
              x={dataDateLabel}
              stroke="var(--muted-foreground)"
              strokeDasharray="2 3"
              label={{
                value: t.progress.dataDateMarker,
                position: "insideTopRight",
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
            />
          )}

          <Area
            type="monotone"
            dataKey="planned"
            stroke="var(--color-planned)"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="url(#planned-fill)"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="var(--color-actual)"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: "var(--color-actual)", strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="18"
              y2="4"
              stroke="var(--chart-4)"
              strokeWidth="2"
              strokeDasharray="5 4"
            />
          </svg>
          {t.progress.chartPlanned}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="18" y2="4" stroke="var(--chart-1)" strokeWidth="2.5" />
          </svg>
          {t.progress.chartActual}
        </span>
      </div>
    </div>
  );
}
