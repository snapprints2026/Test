import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

function formatDate(d) {
  const date = new Date(d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export default function RevenueChart({ data = [], dataKey = "revenue", height = 280 }) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg"
        style={{ height }}
      >
        No revenue in this range yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2457ff" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#2457ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: "#9aa1ac" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: "#9aa1ac" }} axisLine={false} tickLine={false} />
        <Tooltip
          labelFormatter={formatDate}
          formatter={(val) => [`₹${val}`, dataKey === "revenue" ? "Revenue" : dataKey]}
          contentStyle={{ borderRadius: 8, fontSize: 12, border: "1px solid #eef1f5" }}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke="#2457ff"
          strokeWidth={2}
          fill="url(#revFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
