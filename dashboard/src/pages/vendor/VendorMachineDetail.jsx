import React, { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import RangeTabs from "../../components/RangeTabs";
import RevenueChart from "../../components/RevenueChart";
import StatCard from "../../components/StatCard";
import StatusBadge from "../../components/StatusBadge";
import ModuleBadge from "../../components/ModuleBadge";
import Loader from "../../components/Loader";

const ORDER_STATUS = { PAID: "In queue", PRINTING: "Printing", PRINTED: "Printed", FAILED: "Refunded", EXPIRED: "Expired" };

export default function VendorMachineDetail() {
  const { machineId } = useParams();
  const [range, setRange] = useState("week");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Module 2 (shop computer): printers + recent orders
  const [info, setInfo] = useState(null); // { machine, printers }
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    setLoading(true);
    setError("");
    vendorApi
      .getMachineRevenue(machineId, range)
      .then(setRows)
      .catch((err) => setError(err?.response?.data?.error || "Failed to load revenue"))
      .finally(() => setLoading(false));
  }, [machineId, range]);

  const loadShop = useCallback(async () => {
    try {
      const data = await vendorApi.getMachinePrinters(machineId);
      setInfo(data);
      if (data.machine.module === "SHOP") setOrders((await vendorApi.getMachineOrders(machineId)).orders);
    } catch {
      /* revenue error already shown */
    }
  }, [machineId]);

  useEffect(() => {
    loadShop();
  }, [loadShop]);

  // Keep the shop view fresh while it's open
  useEffect(() => {
    if (info?.machine?.module !== "SHOP") return undefined;
    const t = setInterval(loadShop, 15000);
    return () => clearInterval(t);
  }, [info?.machine?.module, loadShop]);

  const togglePrinter = async (p) => {
    try {
      await vendorApi.setPrinterEnabled(p.id, !p.is_enabled);
      loadShop();
    } catch (err) {
      alert(err?.response?.data?.error || "Could not update printer");
    }
  };

  const totalRevenue = rows.reduce((sum, r) => sum + Number(r.revenue || 0), 0);
  const totalPrints = rows.reduce((sum, r) => sum + Number(r.prints || 0), 0);
  const machine = info?.machine;
  const isShop = machine?.module === "SHOP";

  return (
    <DashboardLayout>
      <Link to="/vendor/machines" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to machines
      </Link>
      <h1 className="text-xl font-semibold text-gray-800 mt-2 mb-6 flex items-center gap-2 flex-wrap">
        {machine?.name || machineId}
        {machine && <ModuleBadge module={machine.module} />}
        {machine && <StatusBadge status={machine.is_online ? "ONLINE" : "OFFLINE"} />}
      </h1>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <StatCard label={`Revenue (${range})`} value={`₹${totalRevenue.toLocaleString("en-IN")}`} />
        <StatCard label={`Prints (${range})`} value={totalPrints} />
      </div>

      {isShop && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Printers</h2>
            {info.printers.length === 0 ? (
              <p className="text-sm text-gray-400">Run the print agent setup on the shop computer to add printers.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {info.printers.map((p) => (
                  <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{p.display_name}</p>
                      <p className="text-xs text-gray-400">
                        {p.kind === "COLOR" ? "Colour + B&W" : "B&W"} · {p.supports_duplex ? "double-sided" : "single-sided"} · {p.paper_sizes.join("/")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={!p.is_enabled ? "PAUSED" : p.is_online ? "ONLINE" : "OFFLINE"} />
                      <button className="btn-secondary py-1 text-xs" onClick={() => togglePrinter(p)}>
                        {p.is_enabled ? "Pause" : "Resume"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-700">Recent orders</h2>
            </div>
            <div className="max-h-80 overflow-auto">
              {orders.length === 0 ? (
                <p className="text-sm text-gray-400 p-5">No orders yet.</p>
              ) : (
                <table className="w-full">
                  <tbody>
                    {orders.slice(0, 30).map((o) => (
                      <tr key={o.job_id}>
                        <td className="table-td font-mono font-bold">{o.order_code || "—"}</td>
                        <td className="table-td text-xs text-gray-500">
                          {o.copies}× {o.total_pages}p · {o.color === "color" ? "Colour" : "B&W"}
                          {o.printer_name ? ` · ${o.printer_name}` : ""}
                        </td>
                        <td className="table-td text-xs">{ORDER_STATUS[o.status] || o.status}</td>
                        <td className="table-td text-xs text-right">₹{Number(o.amount || 0).toLocaleString("en-IN")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Revenue trend</h2>
          <RangeTabs value={range} onChange={setRange} />
        </div>
        {loading ? <Loader /> : <RevenueChart data={rows} />}
      </div>
    </DashboardLayout>
  );
}
