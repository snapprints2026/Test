import React from "react";

const RANGES = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "6month", label: "6 Months" },
  { key: "year", label: "Year" },
];

export default function RangeTabs({ value, onChange, options = RANGES }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-1">
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
            value === opt.key
              ? "bg-white shadow-sm text-brand-700"
              : "text-gray-500 hover:text-gray-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
