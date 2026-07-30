"use client";

import { useId } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

/**
 * Charts read their colours from the token layer so dark and light stay in
 * step, and every series is also labelled in the legend — colour alone never
 * carries meaning.
 */
export const SERIES_COLOURS = {
  completed: "var(--color-success)",
  running: "var(--color-info)",
  failed: "var(--color-error)",
  cancelled: "var(--color-faint)",
  accent: "var(--color-accent)",
  agent: "var(--color-agent)",
  warning: "var(--color-warning)",
} as const;

function TooltipCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string; colour: string }>;
}) {
  return (
    <div className="rounded-md border border-border bg-[var(--color-raised)] px-2.5 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-foreground">{title}</p>
      <ul className="flex flex-col gap-0.5">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: row.colour }}
            />
            <span className="text-muted-foreground">{row.label}</span>
            <span className="ml-auto font-mono tabular-nums text-foreground">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Small inline trend line for a stat tile. Deliberately hand-rolled: a tile
 * sparkline needs no axes, tooltip, or layout engine.
 */
export function Sparkline({
  values,
  tone = "neutral",
  label,
  className,
}: {
  values: number[];
  tone?: "neutral" | "positive" | "negative" | "warning";
  label: string;
  className?: string;
}) {
  const gradientFreeId = useId();
  if (values.length < 2) return null;

  const width = 96;
  const height = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const stroke =
    tone === "positive"
      ? "var(--color-success)"
      : tone === "negative"
        ? "var(--color-error)"
        : tone === "warning"
          ? "var(--color-warning)"
          : "var(--color-agent)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-7 w-24 overflow-visible", className)}
      role="img"
      aria-labelledby={gradientFreeId}
      preserveAspectRatio="none"
    >
      <title id={gradientFreeId}>{label}</title>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export type RunActivitySeriesKey =
  | "completed"
  | "running"
  | "failed"
  | "cancelled";

export const RUN_ACTIVITY_SERIES: Array<{
  key: RunActivitySeriesKey;
  label: string;
  colour: string;
}> = [
  { key: "completed", label: "Completed", colour: SERIES_COLOURS.completed },
  { key: "running", label: "In flight", colour: SERIES_COLOURS.running },
  { key: "failed", label: "Failed", colour: SERIES_COLOURS.failed },
  { key: "cancelled", label: "Cancelled", colour: SERIES_COLOURS.cancelled },
];

type ActivityDatum = {
  bucket: string;
  completed: number;
  running: number;
  failed: number;
  cancelled: number;
};

/** Hourly agent-run volume. One line per terminal state. */
export function RunActivityChart({
  data,
  visible,
}: {
  data: ActivityDatum[];
  visible: RunActivitySeriesKey[];
}) {
  const seriesKeys = RUN_ACTIVITY_SERIES.filter((series) =>
    visible.includes(series.key),
  );
  const points = data.map((point) => ({
    ...point,
    axis: new Date(point.bucket).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  }));

  return (
    <div className="h-64 w-full">
      <table className="sr-only">
        <caption>Agent run activity by hour</caption>
        <thead>
          <tr>
            <th scope="col">Time</th>
            {seriesKeys.map((series) => (
              <th key={series.key} scope="col">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket}>
              <th scope="row">{point.axis}</th>
              {seriesKeys.map((series) => (
                <td key={series.key}>{point[series.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ResponsiveContainer width="100%" height="100%" aria-hidden>
        <LineChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="var(--color-rule)"
            strokeDasharray="3 3"
          />
          <XAxis
            dataKey="axis"
            tickLine={false}
            axisLine={false}
            interval={3}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            width={44}
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
          />
          <Tooltip
            cursor={{ stroke: "var(--color-rule-strong)", strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <TooltipCard
                  title={String(label)}
                  rows={payload.map((entry) => ({
                    label: String(entry.name ?? entry.dataKey),
                    value: String(entry.value ?? 0),
                    colour: String(entry.color ?? "var(--color-muted)"),
                  }))}
                />
              );
            }}
          />
          {seriesKeys.map((series) => (
            <Line
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.label}
              stroke={series.colour}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const STATUS_SLICE_COLOURS: Record<string, string> = {
  backlog: "var(--color-faint)",
  ready: "var(--color-info)",
  in_progress: "var(--color-accent)",
  review: "var(--color-warning)",
  done: "var(--color-success)",
};

/** Work-item status split. The centre states the total it is a split of. */
export function StatusDonut({
  slices,
  total,
  totalLabel,
}: {
  slices: Array<{ status: string; label: string; count: number }>;
  total: number;
  totalLabel: string;
}) {
  return (
    <div className="relative h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="count"
            nameKey="label"
            innerRadius="64%"
            outerRadius="92%"
            paddingAngle={2}
            strokeWidth={0}
            isAnimationActive={false}
          >
            {slices.map((slice) => (
              <Cell
                key={slice.status}
                fill={STATUS_SLICE_COLOURS[slice.status] ?? "var(--color-muted)"}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const entry = payload[0];
              if (!entry) return null;
              const count = Number(entry.value ?? 0);
              return (
                <TooltipCard
                  title={String(entry.name ?? "")}
                  rows={[
                    {
                      label: "Work items",
                      value: `${count} (${total > 0 ? Math.round((count / total) * 100) : 0}%)`,
                      colour: String(
                        entry.payload?.fill ?? "var(--color-muted)",
                      ),
                    },
                  ]}
                />
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
        <p className="font-display text-2xl font-semibold tabular-nums">
          {total}
        </p>
        <p className="text-xs text-muted-foreground">{totalLabel}</p>
      </div>
    </div>
  );
}
