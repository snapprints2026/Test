import React from "react";

export default function Loader({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center py-16 text-sm text-gray-400">
      <span className="animate-pulse">{label}</span>
    </div>
  );
}
