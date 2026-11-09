import React from "react";
import { adminApi } from "../../api/admin.api";
import DashboardLayout from "../../components/DashboardLayout";
import TicketsPanel from "../../components/TicketsPanel";
import { PageHeader, useLoad } from "../../components/ui";

export default function AdminTickets() {
  const machines = useLoad(() => adminApi.getMachineInfo(), []);
  return (
    <DashboardLayout>
      <PageHeader title="Support tickets" sub="Complaints from citizens (print page), officers and vendors. The first reply or status change counts as the response time." />
      <TicketsPanel
        role="admin"
        machines={machines.data || []}
        api={{ getTickets: adminApi.getTickets, getTicket: adminApi.getTicket, createTicket: adminApi.createTicket, updateTicket: adminApi.updateTicket }}
      />
    </DashboardLayout>
  );
}
