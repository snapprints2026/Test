import React from "react";
import { vendorApi } from "../../api/vendor.api";
import DashboardLayout from "../../components/DashboardLayout";
import TicketsPanel from "../../components/TicketsPanel";
import { PageHeader, useLoad } from "../../components/ui";

export default function VendorTickets() {
  const machines = useLoad(() => vendorApi.getMachines(), []);
  return (
    <DashboardLayout>
      <PageHeader title="Support tickets" sub="Complaints about your machines from citizens and offices. Reply quickly — response time counts towards the SLA." />
      <TicketsPanel api={vendorApi} role="vendor" machines={machines.data || []} />
    </DashboardLayout>
  );
}
