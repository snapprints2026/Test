import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [tab, setTab] = useState("vendor"); // "admin" | "vendor" | "officer"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(tab, email.trim(), password);
      navigate(`/${tab}`);
    } catch (err) {
      setError(err?.response?.data?.error || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-2xl font-bold text-brand-700">SnapPrints</p>
          <p className="text-sm text-gray-500 mt-1">Sign in to your dashboard</p>
        </div>

        <div className="card p-6">
          <div className="grid grid-cols-3 bg-gray-100 rounded-lg p-1 mb-6">
            {["vendor", "officer", "admin"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setError(""); }}
                className={`py-1.5 text-sm font-medium rounded-md capitalize transition ${
                  tab === t ? "bg-white shadow-sm text-brand-700" : "text-gray-500"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                required
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                required
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in..." : `Sign in as ${tab}`}
            </button>
          </form>
          {tab === "officer" && (
            <p className="text-xs text-gray-400 mt-4">
              Government officers and bank / PSU branch managers get read-only access to usage, invoices, uptime and complaints for their offices.
              Ask your SnapPrints account manager for a login.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
