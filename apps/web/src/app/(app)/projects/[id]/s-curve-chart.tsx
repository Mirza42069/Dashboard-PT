"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useT } from "@/i18n/provider";

/**
 * Planned vs actual completion over the reporting periods — the S-curve.
 *
 * Two decisions worth keeping:
 *
 * - The actual series is drawn with `connectNulls` off. Periods after the last
 *   reading come through as null, so the line simply stops rather than running
 *   flat to the end of the contract. An unreported period should look unknown,
 *   not look like a fortnight of no work.
 *
 * - Planned is a dashed area, actual a solid line. The two series are told
 *   apart by shape as well as by hue, so the chart survives greyscale printing
 *   and the common colour deficiencies.
 */

export type CurvePoint = {
  label: string;
  planned: number;
  actual: number | null;
};

export default function SCurveChart({ data }: { data: CurvePoint[] }) {
  const t = useT();

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="planned-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0.02} />
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
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "0.75rem",
              color: "var(--popover-foreground)",
            }}
            formatter={(value, name) => [
              typeof value === "number" ? `${value.toFixed(1)}%` : "—",
              String(name),
            ]}
          />

          <Area
            type="monotone"
            dataKey="planned"
            name={t.progress.chartPlanned}
            stroke="var(--chart-4)"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="url(#planned-fill)"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            name={t.progress.chartActual}
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            dot={{ r: 2.5, fill: "var(--chart-1)", strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>

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
