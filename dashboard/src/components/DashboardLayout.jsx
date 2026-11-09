import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const ADMIN_NAV = [
  { to: "/admin", label: "Overview", end: true, icon: "📊" },
  { to: "/admin/machines", label: "Machines", icon: "🖨️" },
  { to: "/admin/vendors", label: "Vendors", icon: "🏪" },
  { to: "/admin/customers", label: "Customers", icon: "👥" },
  { to: "/admin/issues", label: "Issues & refunds", icon: "🛟" },
  { to: "/admin/tickets", label: "Support tickets", icon: "🎫" },
  { section: "Government" },
  { to: "/admin/organizations", label: "Organisations", icon: "🏛️" },
  { to: "/admin/contracts", label: "Contracts", icon: "📄" },
  { to: "/admin/forms", label: "Form catalogue", icon: "📝" },
  { to: "/admin/sla", label: "SLA & uptime", icon: "⏱️" },
  { section: "Finance" },
  { to: "/admin/pricing", label: "Pricing rules", icon: "🏷️" },
  { to: "/admin/invoices", label: "Invoices", icon: "🧾" },
  { to: "/admin/settlements", label: "Settlements", icon: "🤝" },
  { to: "/admin/withdrawals", label: "Withdrawals", icon: "💸" },
  { section: "System" },
  { to: "/admin/audit", label: "Audit log", icon: "🔍" },
  { to: "/admin/users", label: "Admin users", icon: "🔑", superOnly: true },
];

const VENDOR_NAV = [
  { to: "/vendor", label: "Overview", end: true, icon: "📊" },
  { to: "/vendor/machines", label: "My Machines", icon: "🖨️" },
  { to: "/vendor/tickets", label: "Support tickets", icon: "🎫" },
  { to: "/vendor/bank", label: "Bank Details", icon: "🏦" },
  { to: "/vendor/withdrawals", label: "Withdrawals", icon: "💸" },
];

const OFFICER_NAV = [
  { to: "/officer", label: "Overview", end: true, icon: "📊" },
  { to: "/officer/reports", label: "Usage reports", icon: "📈" },
  { to: "/officer/machines", label: "Machines", icon: "🖨️" },
  { to: "/officer/sla", label: "Uptime (SLA)", icon: "⏱️" },
  { to: "/officer/invoices", label: "Invoices", icon: "🧾" },
  { to: "/officer/contracts", label: "Contracts & rates", icon: "📄" },
  { to: "/officer/tickets", label: "Complaints", icon: "🎫" },
];

export default function DashboardLayout({ children }) {
  const { role, user, logout, adminRole } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const nav = (role === "admin" ? ADMIN_NAV : role === "officer" ? OFFICER_NAV : VENDOR_NAV)
    .filter((item) => !item.superOnly || adminRole === "SUPER_ADMIN");
  const panelName = role === "officer" ? "Office / branch (read-only)" : role === "admin" ? `Admin · ${String(adminRole || "").replace("_", " ").toLowerCase()}` : "Vendor panel";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const NavLinks = ({ onNavigate }) => (
    <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
      {nav.map((item, i) => item.section ? (
        <p key={`s${i}`} className="px-3 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{item.section}</p>
      ) : (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
              isActive
                ? "bg-brand-50 text-brand-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            }`
          }
        >
          <span className="text-base">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* ── Desktop sidebar (always visible on lg+) ── */}
      <aside className="hidden lg:flex w-60 shrink-0 bg-white border-r border-gray-200 flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-gray-100">
          <p className="text-lg font-bold text-brand-700">SnapPrints</p>
          <p className="text-xs text-gray-400 mt-0.5 capitalize">{panelName}</p>
        </div>
        <NavLinks />
        <div className="px-3 py-4 border-t border-gray-100">
          <button onClick={handleLogout} className="btn-secondary w-full">
            Log out
          </button>
        </div>
      </aside>

      {/* ── Mobile off-canvas sidebar ── */}
      {mobileNavOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col shadow-xl">
            <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="text-lg font-bold text-brand-700">SnapPrints</p>
                <p className="text-xs text-gray-400 mt-0.5 capitalize">{panelName}</p>
              </div>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="text-gray-400 text-xl leading-none px-2"
                aria-label="Close menu"
              >
                ✕
              </button>
            </div>
            <NavLinks onNavigate={() => setMobileNavOpen(false)} />
            <div className="px-3 py-4 border-t border-gray-100">
              <button onClick={handleLogout} className="btn-secondary w-full">
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 bg-white border-b border-gray-200 flex items-center justify-between px-4 sm:px-6">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden text-gray-500 text-xl px-1"
            aria-label="Open menu"
          >
            ☰
          </button>
          <p className="lg:hidden font-bold text-brand-700">SnapPrints</p>
          <div className="text-right">
            <p className="text-sm font-medium text-gray-800">{user?.name}</p>
            <p className="text-xs text-gray-400 hidden sm:block">{role === "officer" && user?.organizationName ? `${user.organizationName} · ` : ""}{user?.email}</p>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
