"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Loader2, PackageSearch, RefreshCw, Search, Truck } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";
import { formatStatusLabel } from "@/lib/display";

type Event = { status?: string; location?: string; description?: string; event_time?: string };
type Shipment = { id: string; pss_reference?: string; client_id: string; status?: string; provider?: string; origin?: string; destination?: string; edd?: string; tracking_number?: string; lr_number?: string; master_awb?: string; provider_reference?: string; pickup_reference?: string; invoice_number?: string; provider_booking_id?: string; provider_pickup_id?: string; box_awbs_json?: string; tracking_events?: Event[] };

function Identifier({ label, value }: { label: string; value?: string }) {
  return <div className="min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-semibold" title={value || "Not available"}>{value || "Not available"}</p></div>;
}

export default function EmployeeTrackingPane() {
  const { profile, getVisibleClients } = useEmployee();
  const clients = getVisibleClients();
  const [rows, setRows] = useState<Shipment[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async (showNotice = false) => {
    setLoading(true); setError("");
    try {
      const result = await pssApi<{ data?: Shipment[] }>("/v1/shipments?view=tracking&include_tracking=1");
      const visible = (result.data ?? []).filter((row) => profile.assignedClientIds.includes(row.client_id));
      setRows(visible);
      if (showNotice) setNotice("Shipment tracking refreshed from production.");
    } catch (caught) { setError(getPssErrorDetails(caught, "Shipment tracking is temporarily unavailable.").message); } finally { setLoading(false); }
  };

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => rows.filter((row) => `${row.id} ${row.pss_reference ?? ""} ${row.origin ?? ""} ${row.destination ?? ""} ${row.status ?? ""} ${row.lr_number ?? ""} ${row.master_awb ?? ""} ${row.invoice_number ?? ""}`.toLowerCase().includes(query.toLowerCase())), [query, rows]);
  const selected = rows.find((row) => row.id === selectedId) ?? filtered[0] ?? rows[0];
  const clientName = selected ? clients.find((client) => client.id === selected.client_id)?.name ?? "Assigned client" : "Assigned client";
  const stages = ["booked", "in_transit", "out_for_delivery", "delivered"];
  const current = selected ? Math.max(0, stages.indexOf(String(selected.status ?? "booked").toLowerCase())) : 0;

  const refreshSelected = async () => {
    if (!selected) return;
    setRefreshing(true); setNotice("");
    try {
      const result = await pssApi<{ data?: Event[]; provider_status?: string }>(`/v1/shipments/${encodeURIComponent(selected.id)}/tracking`);
      const events = result.data ?? [];
      setRows((currentRows) => currentRows.map((row) => row.id === selected.id ? { ...row, tracking_events: events, status: events.at(-1)?.status ?? row.status } : row));
      const providerStatus = String(result.provider_status ?? "").toLowerCase();
      const providerFailed = ["invalid_request", "error", "failed"].includes(providerStatus);
      setNotice(providerFailed
        ? `Live tracking could not be loaded for ${selected.pss_reference ?? selected.id}: ${result.provider_status}.`
        : `Live tracking loaded for ${selected.pss_reference ?? selected.id}: ${result.provider_status ?? "provider status unavailable"}.`);
    } catch (caught) { setNotice(`Tracking refresh failed: ${getPssErrorDetails(caught, "Live tracking could not be loaded.").message}`); } finally { setRefreshing(false); }
  };

  if (loading && !rows.length) return <div className="grid min-h-80 place-items-center rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading production tracking…</span></div>;
  if (!selected && !error) return <div className="grid min-h-80 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center"><div><PackageSearch className="mx-auto size-7 text-muted-foreground" /><h1 className="mt-3 text-base font-semibold">No assigned shipments yet</h1><p className="mt-1 text-sm text-muted-foreground">Tracking will appear here for the clients assigned to you.</p></div></div>;

  return <div className="space-y-4"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-xs font-medium text-primary"><Truck className="size-4" /> Operations</div><h1 className="mt-2 text-2xl font-semibold tracking-tight">Tracking desk</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">The same shipment detail view used by Client, scoped to your assigned clients.</p></div><button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-input px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />Refresh</button></header>{notice && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" />{notice}</div>}{error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{error}</span><button type="button" onClick={() => void load(true)} className="rounded border border-destructive/30 px-2 py-1 font-semibold">Retry</button></div>}<div className="grid gap-4 xl:grid-cols-[minmax(260px,0.38fr)_minmax(0,1fr)]"><section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs"><div className="border-b border-border/70 p-3"><label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shipment, route, LR, or AWB…" className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" /></label></div><div className="max-h-[680px] overflow-auto">{filtered.map((row) => <button key={row.id} type="button" onClick={() => setSelectedId(row.id)} className={`w-full border-b border-border/70 p-3 text-left transition hover:bg-accent/30 ${selected?.id === row.id ? "bg-primary/5" : ""}`}><div className="flex items-start justify-between gap-3"><span className="truncate text-xs font-semibold">{row.pss_reference ?? row.id}</span><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold">{formatStatusLabel(row.status, "Booked")}</span></div><p className="mt-1 truncate text-[11px] text-muted-foreground">{row.origin || "Origin"} → {row.destination || "Destination"}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{clients.find((client) => client.id === row.client_id)?.name ?? "Assigned client"}</p></button>)}{!filtered.length && <p className="p-6 text-center text-xs text-muted-foreground">No assigned shipments match this search.</p>}</div></section>{selected && <section className="min-w-0 space-y-4"><article className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"><div className="flex items-start justify-between gap-3 border-b border-border/70 p-5"><div className="min-w-0"><p className="text-xs text-muted-foreground">{clientName}</p><div className="mt-1 flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight">{selected.pss_reference ?? selected.id}</h2><button type="button" aria-label="Copy shipment reference" onClick={() => { void navigator.clipboard?.writeText(selected.pss_reference ?? selected.id); setNotice("Shipment reference copied."); }} className="rounded p-1 text-muted-foreground hover:bg-accent"><Copy className="size-3.5" /></button></div><p className="mt-1 text-sm text-muted-foreground">{selected.origin || "Origin"} → {selected.destination || "Destination"}</p></div><button type="button" onClick={() => void refreshSelected()} disabled={refreshing} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-input px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />Refresh</button></div><div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3 lg:grid-cols-4"><Identifier label="PSS shipment ID" value={selected.pss_reference ?? selected.id} /><Identifier label="LR / LRN" value={selected.lr_number} /><Identifier label="AWB / waybill" value={selected.master_awb || selected.tracking_number || selected.provider_reference} /><Identifier label="Invoice number" value={selected.invoice_number} /><Identifier label="Pickup reference" value={selected.pickup_reference} /><Identifier label="Provider booking ID" value={selected.provider_booking_id} /><Identifier label="Provider pickup ID" value={selected.provider_pickup_id} /><Identifier label="ETA" value={selected.edd} /></div></article><article className="overflow-hidden rounded-xl border border-border bg-card shadow-xs"><div className="flex items-center gap-2 border-b border-border/70 p-4"><Truck className="size-4 text-primary" /><h2 className="text-sm font-semibold">Shipment tracking</h2></div><div className="p-5"><ol className="space-y-0">{stages.map((stage, index) => <li key={stage} className="relative flex gap-3"><div className="flex w-4 shrink-0 flex-col items-center"><span className={`z-10 mt-0.5 grid size-4 place-items-center rounded-full border-2 bg-background ${index <= current ? "border-emerald-500" : "border-border"}`}>{index <= current && <span className="size-2 rounded-full bg-emerald-500" />}</span>{index < stages.length - 1 && <span className={`w-0.5 flex-1 ${index < current ? "bg-emerald-500" : "bg-border"}`} />}</div><div className={`min-w-0 flex-1 ${index < stages.length - 1 ? "pb-7" : "pb-1"}`}><p className={`text-sm font-semibold ${index <= current ? "text-foreground" : "text-muted-foreground"}`}>{stage === "booked" ? "Manifested" : formatStatusLabel(stage, stage)}</p>{index === current && selected.tracking_events?.at(-1) && <p className="mt-1 text-xs text-muted-foreground">{selected.tracking_events.at(-1)?.description || "Tracking event received"}{selected.tracking_events.at(-1)?.location ? ` · ${selected.tracking_events.at(-1)?.location}` : ""}</p>}</div></li>)}</ol></div></article></section>}</div></div>;
}
