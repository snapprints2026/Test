import React, { useEffect, useState } from "react";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatCard from "../../components/StatCard";
import RangeTabs from "../../components/RangeTabs";
import RevenueChart from "../../components/RevenueChart";
import Loader from "../../components/Loader";

export default function VendorOverview() {
  const [range, setRange] = useState("week");
  const [summary, setSummary] = useState(null);
  const [balance, setBalance] = useState(null);
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([vendorApi.getBalance(), vendorApi.getMachines()])
      .then(([bal, mach]) => {
        setBalance(bal);
        setMachines(mach);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    vendorApi.getRevenueSummary(range).then(setSummary);
  }, [range]);

  if (loading) return <DashboardLayout><Loader /></DashboardLayout>;

  const onlineCount = machines.filter((m) => m.is_online).length;

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-800">Overview</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Machines" value={machines.length} sub={`${onlineCount} online now`} />
        <StatCard
          label="Lifetime Revenue"
          value={`₹${Number(balance?.totalRevenue || 0).toLocaleString("en-IN")}`}
        />
        <StatCard
          label="Total Withdrawn"
          value={`₹${Number(balance?.totalWithdrawn || 0).toLocaleString("en-IN")}`}
        />
        <StatCard
          label="Available Balance"
          value={`₹${Number(balance?.available || 0).toLocaleString("en-IN")}`}
          accent="green"
        />
      </div>

      {(Number(balance?.revenueShare) > 0 || Number(balance?.departmentBilled) > 0 || Number(balance?.totalSettled) > 0) && (
        <div className="card p-4 mb-6 text-sm text-gray-600 flex flex-wrap gap-x-8 gap-y-2">
          {Number(balance?.revenueShare) > 0 && (
            <span>Revenue share owed to departments: <b>₹{Number(balance.revenueShare).toLocaleString("en-IN")}</b></span>
          )}
          {Number(balance?.departmentBilled) > 0 && (
            <span>Department-billed usage (paid on invoice, not in balance): <b>₹{Number(balance.departmentBilled).toLocaleString("en-IN")}</b></span>
          )}
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Revenue trend</h2>
          <RangeTabs value={range} onChange={setRange} />
        </div>
        <RevenueChart data={summary?.series || []} />
        {summary?.totals && (
          <p className="text-xs text-gray-400 mt-3">
            {summary.totals.total_prints} total prints · ₹
            {Number(summary.totals.total_revenue).toLocaleString("en-IN")} lifetime
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
