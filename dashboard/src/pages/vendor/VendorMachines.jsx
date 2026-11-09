import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import StatusBadge from "../../components/StatusBadge";
import Loader from "../../components/Loader";
import ModuleBadge from "../../components/ModuleBadge";

export default function VendorMachines() {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    vendorApi.getMachines().then(setMachines).finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">My Machines</h1>

      {loading ? (
        <Loader />
      ) : machines.length === 0 ? (
        <div className="card p-10 text-center text-sm text-gray-400">
          No machines assigned to you yet. Contact the admin to get a machine assigned.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Machine</th>
                <th className="table-th">Type</th>
                <th className="table-th">Location</th>
                <th className="table-th">Status</th>
                <th className="table-th">Total prints</th>
                <th className="table-th">Revenue</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.machine_id}>
                  <td className="table-td font-medium">{m.name || m.machine_id}</td>
                  <td className="table-td"><ModuleBadge module={m.module} /></td>
                  <td className="table-td text-gray-500">
                    {m.location_label || m.location_name ? `${m.location_label || m.location_name}${m.city ? `, ${m.city}` : ""}` : "—"}
                    {(m.contact_name || m.open_time) && (
                      <span className="block text-xs text-gray-400">
                        {[m.contact_name && `${m.contact_name}${m.contact_phone ? ` (${m.contact_phone})` : ""}`,
                          m.open_time && `${m.open_time}–${m.close_time}`].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </td>
                  <td className="table-td">
                    <StatusBadge status={m.is_online ? "ONLINE" : "OFFLINE"} />
                    {m.is_print_locked ? (
                      <span className="ml-2 text-xs text-red-600">Paper locked</span>
                    ) : null}
                  </td>
                  <td className="table-td">{m.total_prints || 0}</td>
                  <td className="table-td">₹{Number(m.total_revenue || 0).toLocaleString("en-IN")}</td>
                  <td className="table-td text-right">
                    <Link
                      to={`/vendor/machines/${m.machine_id}`}
                      className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </DashboardLayout>
  );
}
