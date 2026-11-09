import React, { useEffect, useState } from "react";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import Loader from "../../components/Loader";

const EMPTY = {
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  ifsc: "",
  branchName: "",
  accountType: "SAVINGS",
};

export default function VendorBank() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    vendorApi
      .getBankAccount()
      .then((bank) => {
        if (bank) {
          setForm({
            bankName: bank.bank_name || "",
            accountHolder: bank.account_holder || "",
            accountNumber: bank.account_number || "",
            ifsc: bank.ifsc || "",
            branchName: bank.branch_name || "",
            accountType: bank.account_type || "SAVINGS",
          });
          setVerified(!!bank.verified);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    try {
      await vendorApi.upsertBankAccount(form);
      setMessage("Bank details saved. It will show as unverified until the admin confirms it.");
      setVerified(false);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to save bank details");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <DashboardLayout><Loader /></DashboardLayout>;

  return (
    <DashboardLayout>
      <h1 className="text-xl font-semibold text-gray-800 mb-6">Bank Details</h1>

      <div className="card p-6 max-w-lg">
        {verified && (
          <div className="mb-4 text-xs font-medium text-green-700 bg-green-50 px-3 py-2 rounded-lg">
            ✓ Verified by admin
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank name</label>
            <input required className="input" value={form.bankName} onChange={handleChange("bankName")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Account holder name</label>
            <input required className="input" value={form.accountHolder} onChange={handleChange("accountHolder")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Account number</label>
            <input required className="input" value={form.accountNumber} onChange={handleChange("accountNumber")} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">IFSC code</label>
              <input required className="input" value={form.ifsc} onChange={handleChange("ifsc")} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Account type</label>
              <select className="input" value={form.accountType} onChange={handleChange("accountType")}>
                <option value="SAVINGS">Savings</option>
                <option value="CURRENT">Current</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Branch name (optional)</label>
            <input className="input" value={form.branchName} onChange={handleChange("branchName")} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {message && <p className="text-sm text-green-600">{message}</p>}

          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? "Saving..." : "Save bank details"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
