import React, { useEffect, useState } from "react";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import Loader from "../../components/Loader";

const TABS = ["PENDING", "APPROVED", "PAID", "REJECTED", "ALL"];

export default function AdminWithdrawals() {
  const [tab, setTab] = useState("PENDING");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true);
    adminApi
      .getWithdrawals(tab === "ALL" ? null : tab)
      .then(setRows)
      .finally(() => setLoading(false));
  };

  useEffect(load, [tab]);

  const act = async (id, status) => {
    let remarks = "";
    if (status === "REJECTED") {
      remarks = window.prompt("Reason for rejection (optional):") || "";
    }
    setBusyId(id);
    try {
      await adminApi.updateWithdrawalStatus(id, status, remarks);
      load();
    } catch (err) {
      alert(err?.response?.data?.error || "Failed to update withdrawal");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">Withdrawals</h1>

      <div className="inline-flex bg-gray-100 rounded-lg p-1 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${
              tab === t ? "bg-white shadow-sm text-brand-700" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.toLowerCase()}
          </button>
        ))}
      </div>

      {loading ? (
        <Loader />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Vendor</th>
                <th className="table-th">Amount</th>
                <th className="table-th">Requested</th>
                <th className="table-th">Status</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-td text-center text-gray-400 py-8">
                    No withdrawals in this state
                  </td>
                </tr>
              ) : (
                rows.map((w) => (
                  <tr key={w.id}>
                    <td className="table-td">
                      <p className="font-medium">{w.vendor_name}</p>
                      <p className="text-xs text-gray-400">{w.vendor_email}</p>
                    </td>
                    <td className="table-td font-medium">₹{Number(w.amount).toLocaleString("en-IN")}</td>
                    <td className="table-td text-gray-500">
                      {new Date(w.requested_at).toLocaleDateString("en-IN")}
                    </td>
                    <td className="table-td"><StatusBadge status={w.status} /></td>
                    <td className="table-td text-right space-x-2">
                      {w.status === "PENDING" && (
                        <>
                          <button
                            disabled={busyId === w.id}
                            onClick={() => act(w.id, "APPROVED")}
                            className="text-xs font-medium text-green-700 hover:underline"
                          >
                            Approve
                          </button>
                          <button
                            disabled={busyId === w.id}
                            onClick={() => act(w.id, "REJECTED")}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {w.status === "APPROVED" && (
                        <button
                          disabled={busyId === w.id}
                          onClick={() => act(w.id, "PAID")}
                          className="text-xs font-medium text-brand-700 hover:underline"
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </DashboardLayout>
  );
}
