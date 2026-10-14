"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageSearch, RefreshCw, Search } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";
import { formatStatusLabel } from "@/lib/display";

type ShipmentRow = { id: string; pss_reference?: string; client_id: string; status?: string; origin?: string; destination?: string; edd?: string; lr_number?: string; master_awb?: string; tracking_number?: string; provider_reference?: string; pickup_reference?: string; invoice_number?: string; provider_booking_id?: string; provider_pickup_id?: string; box_awbs_json?: string };

function boxAwbs(value?: string) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => typeof item === "string" ? item.trim() : typeof item === "object" && item !== null && "awb" in item ? String((item as { awb?: unknown }).awb ?? "").trim() : "").filter(Boolean) : [];
  } catch { return []; }
}

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
    void pssApi<{ data?: ShipmentRow[] }>("/v1/shipments?view=tracking&include_tracking=1")
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
    const haystack = `${row.id} ${row.pss_reference ?? ""} ${row.origin ?? ""} ${row.destination ?? ""} ${row.status ?? ""} ${row.lr_number ?? ""} ${row.master_awb ?? ""} ${row.tracking_number ?? ""} ${row.provider_reference ?? ""} ${row.pickup_reference ?? ""} ${row.invoice_number ?? ""}`.toLowerCase();
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
    {loading ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Loading assigned shipments…</div> : visible.length ? <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"><div className="border-b border-border/70 px-4 py-3 text-xs text-muted-foreground">Showing {visible.length} shipment{visible.length === 1 ? "" : "s"} within your assigned client scope.</div><div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground"><tr>{["PSS shipment", "Courier references", "Client / route", "Status", "ETA"].map((heading) => <th key={heading} className="px-4 py-3 font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-border/70">{visible.map((shipment) => { const awbs = boxAwbs(shipment.box_awbs_json); return <tr key={shipment.id} className="transition hover:bg-accent/30"><td className="px-4 py-3 font-mono font-semibold">{shipment.pss_reference ?? shipment.id}</td><td className="px-4 py-3 font-mono text-[11px] text-muted-foreground"><div className="space-y-0.5">{shipment.lr_number && <p><span className="mr-1.5 font-sans text-[10px] uppercase tracking-wide text-foreground">LRN</span>{shipment.lr_number}</p>}{(shipment.master_awb || shipment.tracking_number || shipment.provider_reference) && <p><span className="mr-1.5 font-sans text-[10px] uppercase tracking-wide text-foreground">AWB</span>{shipment.master_awb || shipment.tracking_number || shipment.provider_reference}</p>}{awbs.length ? <p><span className="mr-1.5 font-sans text-[10px] uppercase tracking-wide text-foreground">Box AWB</span>{awbs.join(", ")}</p> : null}{shipment.invoice_number && <p><span className="mr-1.5 font-sans text-[10px] uppercase tracking-wide text-foreground">Invoice</span>{shipment.invoice_number}</p>}{shipment.pickup_reference && <p><span className="mr-1.5 font-sans text-[10px] uppercase tracking-wide text-foreground">PUR</span>{shipment.pickup_reference}</p>}{!shipment.lr_number && !shipment.master_awb && !shipment.tracking_number && !shipment.provider_reference && <p className="font-sans">Provider references pending</p>}</div></td><td className="px-4 py-3"><p className="font-semibold">{clients.find((client) => client.id === shipment.client_id)?.name ?? "Assigned client"}</p><p className="mt-1 text-[11px] text-muted-foreground">{shipment.origin || "Origin"} → {shipment.destination || "Destination"}</p></td><td className="px-4 py-3"><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{formatStatusLabel(shipment.status, "Booked")}</span></td><td className="px-4 py-3 text-muted-foreground">{shipment.edd || "Not provided"}</td></tr>; })}</tbody></table></div></section> : <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No assigned shipments match this search.</div>}
  </div>;
}
