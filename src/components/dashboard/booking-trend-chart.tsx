"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Dashboard charts.
 *
 * Colours map to the same status vocabulary used by the badges, so a slice and
 * a badge for the same status always agree. Charts are presentation only — the
 * numbers are computed server-side.
 */

const AXIS_STYLE = { fontSize: 11, fill: "#738195" } as const;

export function BookingTrendChart({
  data,
}: {
  data: { date: string; bookings: number }[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-muted">
        No bookings in the selected period.
      </p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#DCE5EF" vertical={false} />
          <XAxis
            dataKey="date"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={{ stroke: "#DCE5EF" }}
            // Dates are already short ISO days; show the day and month only.
            tickFormatter={(value: string) => value.slice(5)}
          />
          <YAxis
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: "#EAF0F8" }}
            contentStyle={{
              borderRadius: 6,
              border: "1px solid #DCE5EF",
              fontSize: 12,
            }}
          />
          <Bar dataKey="bookings" fill="#0754A6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLOURS: Record<string, string> = {
  DRAFT: "#95A1B2",
  PENDING: "#D99523",
  NEEDS_REVIEW: "#B26A04",
  CONFIRMED: "#1B8A5A",
  TICKETED: "#0F6B47",
  CANCELLED: "#C0392F",
  COMPLETED: "#0754A6",
};

export function StatusDistributionChart({
  data,
}: {
  data: { status: string; count: number }[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-ink-muted">
        No bookings in the selected period.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="h-48 w-full sm:w-48">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius={40}
              outerRadius={72}
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.status}
                  fill={STATUS_COLOURS[entry.status] ?? "#95A1B2"}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                borderRadius: 6,
                border: "1px solid #DCE5EF",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* A text legend alongside the chart, so the breakdown is readable
          without relying on colour discrimination. */}
      <ul className="flex-1 space-y-1">
        {data.map((entry) => (
          <li key={entry.status} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: STATUS_COLOURS[entry.status] ?? "#95A1B2" }}
              aria-hidden="true"
            />
            <span className="flex-1 text-ink-muted">
              {entry.status.replace(/_/g, " ").toLowerCase()}
            </span>
            <span className="tabular font-medium text-ink">{entry.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
