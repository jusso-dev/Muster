"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { operationsTrend } from "@/lib/demo-data";

export function OperationsChart() {
  return (
    <div className="h-48 w-full" role="img" aria-label="Alerts and investigations over seven hours">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={operationsTrend} margin={{ top: 8, right: 8, left: -24, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} className="chart-grid" />
          <XAxis dataKey="time" tickLine={false} axisLine={false} className="chart-axis" fontSize={10} />
          <YAxis tickLine={false} axisLine={false} className="chart-axis" fontSize={10} />
          <Tooltip
            contentStyle={{
              background: "var(--color-paper-3)",
              border: "1px solid var(--color-rule)",
              borderRadius: "var(--radius-md)",
              fontSize: 11,
            }}
          />
          <Line type="monotone" dataKey="alerts" className="chart-line-primary" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="investigations" className="chart-line-secondary" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
