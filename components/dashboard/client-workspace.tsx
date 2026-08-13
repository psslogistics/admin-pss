"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, Clock3, PackagePlus, ShieldCheck, Truck } from "lucide-react";
import { assignedClients, clientWorkspaceData } from "@/lib/employee-data";

export default function ClientWorkspace({ clientId }: { clientId: string }) {
  const client = assignedClients.find((item) => item.id === clientId) ?? assignedClients[0];
  const data = clientWorkspaceData[client.id as keyof typeof clientWorkspaceData];
  const [notice, setNotice] = useState("");
  const act = (message: string) => setNotice(`${message} recorded for ${client.name}.`);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Link href="/dashboard/myClients" className="inline-flex w-fit items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back to my clients
        </Link>
        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary"><ShieldCheck className="size-3.5" /> Acting on behalf of client</div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">{client.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">You are operating this client workspace as Rahul Sharma. Every action is recorded.</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2 text-xs"><p className="text-muted-foreground">Assigned client</p><p className="mt-1 font-medium">{client.contact} · {client.location}</p></div>
          </div>
        </div>
        {notice && <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"><Check className="size-4" />{notice}</div>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => act("Shipment booking")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"><PackagePlus className="size-4" /> Book shipment</button>
          <button onClick={() => act("Pickup request")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-xs hover:bg-muted"><Truck className="size-4" /> Schedule pickup</button>
        </div>
      </div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
        <div className="rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="border-b border-border/60 px-5 py-4"><h2 className="text-sm font-semibold">Client shipments</h2><p className="mt-1 text-xs text-muted-foreground">The same operational view available in the client portal.</p></div>
          <div className="divide-y divide-border/60">{data.shipments.map((shipment) => <div key={shipment.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><div className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><Truck className="size-4" /></div><div className="min-w-[220px] flex-1"><p className="text-sm font-medium">{shipment.id}</p><p className="mt-1 text-xs text-muted-foreground">{shipment.route} · ETA {shipment.eta}</p></div><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">{shipment.status}</span></div>)}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="border-b border-border/60 px-5 py-4"><h2 className="text-sm font-semibold">Support tickets</h2></div>
          <div className="p-5">
            {data.tickets.length ? data.tickets.map((ticket) => <div key={ticket.id} className="rounded-lg border border-border/60 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{ticket.id}</p><span className="text-[10px] text-amber-600 dark:text-amber-400">{ticket.sla}</span></div><p className="mt-2 text-sm">{ticket.title}</p><p className="mt-1 text-xs text-muted-foreground">Status: {ticket.status}</p></div>) : <div className="py-5 text-center text-sm text-muted-foreground">No open tickets.</div>}
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Admin actions are added to the audit timeline.</div>
          </div>
        </div>
      </section>
    </div>
  );
}
