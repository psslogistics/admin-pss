"use client";

import { useState } from "react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import ProviderHealth from "@/components/dashboard/provider-health";

export default function EmployeeCouriers() {
  const { getVisibleClients } = useEmployee();
  const clients = getVisibleClients();
  const [selectedClient, setSelectedClient] = useState(clients[0]?.id ?? "");

  return <div className="space-y-6">
    <header>
      <p className="text-xs font-medium text-primary">Account & Integrations</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Courier integrations</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Read-only provider readiness and assigned-client courier metadata. Credentials and organization-wide account health are never shown here.</p>
    </header>
    <section className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor="courier-client" className="text-xs font-semibold">Assigned client</label>
      <select id="courier-client" value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)} disabled={!clients.length} className="h-10 min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:min-w-72">
        {!clients.length && <option value="">No assigned clients</option>}
        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </select>
    </section>
    {selectedClient ? <ProviderHealth clientId={selectedClient} /> : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No assigned client is available for courier metadata.</p>}
  </div>;
}
