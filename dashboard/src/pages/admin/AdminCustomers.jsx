import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import Loader from "../../components/Loader";

export default function AdminCustomers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getCustomers().then(setCustomers).finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">Customers</h1>

      {loading ? (
        <Loader />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Phone</th>
                <th className="table-th">Orders</th>
                <th className="table-th">Total spent</th>
                <th className="table-th">Issues</th>
                <th className="table-th">Joined</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-td text-center text-gray-400 py-8">
                    No customers yet
                  </td>
                </tr>
              ) : (
                customers.map((c) => {
                  const issueCount = Number(c.problem_jobs || 0) + Number(c.stuck_jobs || 0);
                  return (
                    <tr key={c.id}>
                      <td className="table-td font-medium">{c.name}</td>
                      <td className="table-td text-gray-500">{c.phone}</td>
                      <td className="table-td">{c.total_orders}</td>
                      <td className="table-td">₹{Number(c.total_spent).toLocaleString("en-IN")}</td>
                      <td className="table-td">
                        {issueCount > 0 ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            {issueCount} to review
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="table-td text-gray-500">
                        {new Date(c.created_at).toLocaleDateString("en-IN")}
                      </td>
                      <td className="table-td text-right">
                        <Link
                          to={`/admin/customers/${c.id}`}
                          className="text-brand-600 hover:text-brand-700 text-sm font-medium"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </DashboardLayout>
  );
}
