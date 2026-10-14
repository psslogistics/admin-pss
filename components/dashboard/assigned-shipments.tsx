"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageSearch, RefreshCw, Search } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";
import { formatStatusLabel } from "@/lib/display";

type ShipmentRow = { id: string; client_id: string; status?: string; origin?: string; destination?: string; edd?: string; lr_number?: string; master_awb?: string };

export default function AssignedShipments() {
  const { profile, getVisibleClients } = useEmployee();
  const clients = getVisibleClients();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [query, setQuery] = useState("");
  const [clientId, setClientId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    void pssApi<{ data?: ShipmentRow[] }>("/v1/shipments")
      .then((result) => setRows(result.data ?? []))
      .catch((caught) => setError(getPssErrorDetails(caught, "Shipment records are temporarily unavailable.").message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = useMemo(() => rows.filter((row) => {
    if (!profile.assignedClientIds.includes(row.client_id)) return false;
    if (clientId && row.client_id !== clientId) return false;
    const haystack = `${row.id} ${row.origin ?? ""} ${row.destination ?? ""} ${row.status ?? ""} ${row.lr_number ?? ""} ${row.master_awb ?? ""}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [clientId, profile.assignedClientIds, query, rows]);

  return <div className="space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="flex items-center gap-2 text-xs font-medium text-primary"><PackageSearch className="size-4" /> Operations</div><h1 className="mt-2 text-2xl font-semibold tracking-tight">Shipment register</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Every shipment belonging to your assigned clients, with operational references and current status.</p></div>
      <button type="button" onClick={load} disabled={loading} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />{loading ? "Refreshing…" : "Refresh"}</button>
    </header>
    <section className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-3 shadow-xs sm:flex-row">
      <label className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shipment, route, LR, or AWB…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" /></label>
      <select aria-label="Filter shipments by assigned client" value={clientId} onChange={(event) => setClientId(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm"><option value="">All assigned clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
    </section>
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{error}</span><button type="button" onClick={load} className="rounded border border-destructive/30 px-2 py-1 font-semibold">Retry</button></div>}
    {loading ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Loading assigned shipments…</div> : visible.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{visible.map((shipment) => <article key={shipment.id} className="rounded-xl border border-border/70 bg-card p-4 shadow-xs"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{shipment.id}</p><p className="mt-1 text-xs text-muted-foreground">{shipment.origin || "Origin"} → {shipment.destination || "Destination"}</p><p className="mt-1 text-[11px] text-muted-foreground">{clients.find((client) => client.id === shipment.client_id)?.name ?? "Assigned client"}</p></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{formatStatusLabel(shipment.status, "Booked")}</span></div><div className="mt-3 space-y-1 rounded-lg bg-muted/30 p-2 text-[10px] text-muted-foreground">{shipment.lr_number && <p><strong className="mr-2 text-foreground">LR/LRN</strong>{shipment.lr_number}</p>}{shipment.master_awb && <p><strong className="mr-2 text-foreground">Master AWB</strong>{shipment.master_awb}</p>}<p><strong className="mr-2 text-foreground">ETA</strong>{shipment.edd || "Not provided"}</p></div></article>)}</div> : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No assigned shipments match this search.</div>}
  </div>;
}
