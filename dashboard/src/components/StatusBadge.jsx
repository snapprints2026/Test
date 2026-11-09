import React from "react";

const STYLES = {
  ACTIVE: "bg-green-100 text-green-700",
  ONLINE: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  DISABLED: "bg-gray-200 text-gray-600",
  INACTIVE: "bg-gray-200 text-gray-600",
  OFFLINE: "bg-gray-200 text-gray-600",
  MAINTENANCE: "bg-amber-100 text-amber-700",
  PAUSED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-green-100 text-green-700",
  REJECTED: "bg-red-100 text-red-700",
  PAID: "bg-brand-100 text-brand-700",
  // print_jobs.status values
  CREATED: "bg-gray-100 text-gray-600",
  PRICED: "bg-gray-100 text-gray-600",
  PAYING: "bg-amber-100 text-amber-700",
  PRINTING: "bg-blue-100 text-blue-700",
  PRINTED: "bg-green-100 text-green-700",
  FAILED: "bg-red-100 text-red-700",
  EXPIRED: "bg-orange-100 text-orange-700",
  // job_issues.status + print_jobs.refund_status
  OPEN: "bg-amber-100 text-amber-700",
  AUTO_APPROVED: "bg-green-100 text-green-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  PROCESSED: "bg-green-100 text-green-700",
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {status}
    </span>
  );
}
