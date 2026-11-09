import React, { useEffect, useState } from "react";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import StatCard from "../../components/StatCard";
import Loader from "../../components/Loader";

export default function VendorWithdrawals() {
  const [balance, setBalance] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([vendorApi.getBalance(), vendorApi.getWithdrawals()])
      .then(([bal, w]) => {
        setBalance(bal);
        setWithdrawals(w);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleRequest = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      await vendorApi.requestWithdrawal(amt);
      setMessage("Withdrawal request submitted.");
      setAmount("");
      load();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <DashboardLayout><Loader /></DashboardLayout>;

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">Withdrawals</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Lifetime Revenue" value={`₹${Number(balance?.totalRevenue || 0).toLocaleString("en-IN")}`} />
        <StatCard label="Total Withdrawn" value={`₹${Number(balance?.totalWithdrawn || 0).toLocaleString("en-IN")}`} />
        <StatCard label="Available Balance" value={`₹${Number(balance?.available || 0).toLocaleString("en-IN")}`} accent="green" />
      </div>

      <div className="card p-6 max-w-md mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Request a withdrawal</h2>
        <form onSubmit={handleRequest} className="flex gap-3">
          <input
            type="number"
            min="1"
            step="0.01"
            placeholder="Amount in ₹"
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button type="submit" disabled={submitting} className="btn-primary whitespace-nowrap">
            {submitting ? "Submitting..." : "Request"}
          </button>
        </form>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {message && <p className="text-sm text-green-600 mt-2">{message}</p>}
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="table-th">Requested</th>
              <th className="table-th">Amount</th>
              <th className="table-th">Status</th>
              <th className="table-th">Remarks</th>
            </tr>
          </thead>
          <tbody>
            {withdrawals.length === 0 ? (
              <tr>
                <td colSpan={4} className="table-td text-center text-gray-400 py-8">
                  No withdrawal requests yet
                </td>
              </tr>
            ) : (
              withdrawals.map((w) => (
                <tr key={w.id}>
                  <td className="table-td">{new Date(w.requested_at).toLocaleDateString("en-IN")}</td>
                  <td className="table-td font-medium">₹{Number(w.amount).toLocaleString("en-IN")}</td>
                  <td className="table-td"><StatusBadge status={w.status} /></td>
                  <td className="table-td text-gray-500">{w.remarks || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
