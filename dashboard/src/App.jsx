import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import ProtectedRoute from "./components/ProtectedRoute";
import HomePage from "./pages/HomePage";
import Login from "./pages/Login";

import AdminOverview from "./pages/admin/AdminOverview";
import AdminMachines from "./pages/admin/AdminMachines";
import AdminMachineDetail from "./pages/admin/AdminMachineDetail";
import AdminVendors from "./pages/admin/AdminVendors";
import AdminVendorDetail from "./pages/admin/AdminVendorDetail";
import AdminCustomers from "./pages/admin/AdminCustomers";
import AdminCustomerDetail from "./pages/admin/AdminCustomerDetail";
import AdminWithdrawals from "./pages/admin/AdminWithdrawals";
import AdminTickets from "./pages/admin/AdminTickets";
import AdminIssues from "./pages/admin/AdminIssues";
import AdminOrganizations from "./pages/admin/gov/AdminOrganizations";
import AdminOrganizationDetail from "./pages/admin/gov/AdminOrganizationDetail";
import AdminContracts from "./pages/admin/gov/AdminContracts";
import AdminContractDetail from "./pages/admin/gov/AdminContractDetail";
import AdminForms from "./pages/admin/gov/AdminForms";
import AdminSla from "./pages/admin/gov/AdminSla";
import AdminPricing from "./pages/admin/finance/AdminPricing";
import AdminInvoices from "./pages/admin/finance/AdminInvoices";
import AdminSettlements from "./pages/admin/finance/AdminSettlements";
import AdminAudit from "./pages/admin/system/AdminAudit";
import AdminUsers from "./pages/admin/system/AdminUsers";

import {
  OfficerOverview, OfficerReports, OfficerMachines, OfficerSla, OfficerInvoices, OfficerContracts, OfficerTickets,
} from "./pages/officer/OfficerPages";

import VendorOverview from "./pages/vendor/VendorOverview";
import VendorMachines from "./pages/vendor/VendorMachines";
import VendorMachineDetail from "./pages/vendor/VendorMachineDetail";
import VendorBank from "./pages/vendor/VendorBank";
import VendorWithdrawals from "./pages/vendor/VendorWithdrawals";
import VendorTickets from "./pages/vendor/VendorTickets";

const admin = (el) => <ProtectedRoute requiredRole="admin">{el}</ProtectedRoute>;
const officer = (el) => <ProtectedRoute requiredRole="officer">{el}</ProtectedRoute>;

export default function App() {
  return (
    <Routes>
      {/* Public landing page */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<Login />} />

      {/* Admin */}
      <Route path="/admin" element={<ProtectedRoute requiredRole="admin"><AdminOverview /></ProtectedRoute>} />
      <Route path="/admin/machines" element={<ProtectedRoute requiredRole="admin"><AdminMachines /></ProtectedRoute>} />
      <Route path="/admin/machines/:machineId" element={<ProtectedRoute requiredRole="admin"><AdminMachineDetail /></ProtectedRoute>} />
      <Route path="/admin/vendors" element={<ProtectedRoute requiredRole="admin"><AdminVendors /></ProtectedRoute>} />
      <Route path="/admin/vendors/:vendorId" element={<ProtectedRoute requiredRole="admin"><AdminVendorDetail /></ProtectedRoute>} />
      <Route path="/admin/customers" element={<ProtectedRoute requiredRole="admin"><AdminCustomers /></ProtectedRoute>} />
      <Route path="/admin/customers/:customerId" element={<ProtectedRoute requiredRole="admin"><AdminCustomerDetail /></ProtectedRoute>} />
      <Route path="/admin/withdrawals" element={<ProtectedRoute requiredRole="admin"><AdminWithdrawals /></ProtectedRoute>} />
      <Route path="/admin/tickets" element={admin(<AdminTickets />)} />
      <Route path="/admin/issues" element={admin(<AdminIssues />)} />
      <Route path="/admin/organizations" element={admin(<AdminOrganizations />)} />
      <Route path="/admin/organizations/:orgId" element={admin(<AdminOrganizationDetail />)} />
      <Route path="/admin/contracts" element={admin(<AdminContracts />)} />
      <Route path="/admin/contracts/:contractId" element={admin(<AdminContractDetail />)} />
      <Route path="/admin/forms" element={admin(<AdminForms />)} />
      <Route path="/admin/sla" element={admin(<AdminSla />)} />
      <Route path="/admin/pricing" element={admin(<AdminPricing />)} />
      <Route path="/admin/invoices" element={admin(<AdminInvoices />)} />
      <Route path="/admin/settlements" element={admin(<AdminSettlements />)} />
      <Route path="/admin/audit" element={admin(<AdminAudit />)} />
      <Route path="/admin/users" element={admin(<AdminUsers />)} />

      {/* Department officer (read-only) */}
      <Route path="/officer" element={officer(<OfficerOverview />)} />
      <Route path="/officer/reports" element={officer(<OfficerReports />)} />
      <Route path="/officer/machines" element={officer(<OfficerMachines />)} />
      <Route path="/officer/sla" element={officer(<OfficerSla />)} />
      <Route path="/officer/invoices" element={officer(<OfficerInvoices />)} />
      <Route path="/officer/contracts" element={officer(<OfficerContracts />)} />
      <Route path="/officer/tickets" element={officer(<OfficerTickets />)} />

      {/* Vendor */}
      <Route path="/vendor" element={<ProtectedRoute requiredRole="vendor"><VendorOverview /></ProtectedRoute>} />
      <Route path="/vendor/machines" element={<ProtectedRoute requiredRole="vendor"><VendorMachines /></ProtectedRoute>} />
      <Route path="/vendor/machines/:machineId" element={<ProtectedRoute requiredRole="vendor"><VendorMachineDetail /></ProtectedRoute>} />
      <Route path="/vendor/bank" element={<ProtectedRoute requiredRole="vendor"><VendorBank /></ProtectedRoute>} />
      <Route path="/vendor/withdrawals" element={<ProtectedRoute requiredRole="vendor"><VendorWithdrawals /></ProtectedRoute>} />
      <Route path="/vendor/tickets" element={<ProtectedRoute requiredRole="vendor"><VendorTickets /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
