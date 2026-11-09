import React, { useEffect, useState } from "react";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatCard from "../../components/StatCard";
import RangeTabs from "../../components/RangeTabs";
import RevenueChart from "../../components/RevenueChart";
import Loader from "../../components/Loader";
import { Link } from "react-router-dom";
import { SegmentBadge } from "../../components/ui";

// admin.controller's /revenue endpoint uses "today|week|month|year" (no 6month).
const ADMIN_RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const [overview, setOverview] = useState(null);
  const [period, setPeriod] = useState("week");
  const [revenue, setRevenue] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([adminApi.getStats(), adminApi.getRevenueOverview()])
      .then(([s, o]) => {
        setStats(s);
        setOverview(o);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    adminApi.getRevenue(period).then((rows) =>
      // normalize "day" -> "date" key so RevenueChart works unchanged
      setRevenue(rows.map((r) => ({ date: r.day, revenue: r.revenue })))
    );
  }, [period]);

  if (loading) return <DashboardLayout><Loader /></DashboardLayout>;

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">Overview</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Jobs Today" value={stats.jobsToday} />
        <StatCard label="Revenue Today" value={`₹${Number(stats.revenueToday).toLocaleString("en-IN")}`} />
        <StatCard label="Machines Online" value={`${stats.machinesOnline} / ${stats.machinesTotal}`} />
        <StatCard
          label="Platform Lifetime Revenue"
          value={`₹${Number(overview?.totals?.total_revenue || 0).toLocaleString("en-IN")}`}
          accent="green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Machines by segment</h2>
          <div className="flex flex-wrap gap-3">
            {(stats.machinesBySegment || []).map((s) => (
              <div key={s.segment} className="flex items-center gap-2 text-sm"><SegmentBadge segment={s.segment} /> <b>{s.machines}</b></div>
            ))}
          </div>
        </div>
        <Link to="/admin/tickets" className="card p-5 hover:border-brand-300">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Open support tickets</h2>
          <p className={`text-2xl font-semibold ${stats.openTickets ? "text-red-600" : "text-green-700"}`}>{stats.openTickets || 0}</p>
          <p className="text-xs text-gray-400 mt-1">Citizens, officers and vendors · view all →</p>
        </Link>
      </div>

      <div className="card p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Platform revenue trend</h2>
          <RangeTabs value={period} onChange={setPeriod} options={ADMIN_RANGES} />
        </div>
        <RevenueChart data={revenue} />
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Revenue by vendor</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-th">Vendor</th>
              <th className="table-th">Prints</th>
              <th className="table-th">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {(overview?.perVendor || []).map((v) => (
              <tr key={v.vendor_id}>
                <td className="table-td font-medium">{v.vendor_name}</td>
                <td className="table-td">{v.prints}</td>
                <td className="table-td">₹{Number(v.revenue).toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
