"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, ShieldX } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";

type KycStatus = { status?: string; approved?: boolean; missing_fields?: string[] };

export default function EmployeeKyc() {
  const { getVisibleClients, can } = useEmployee();
  const clients = getVisibleClients();
  const [selectedClient, setSelectedClient] = useState(clients[0]?.id ?? "");
  const [result, setResult] = useState<KycStatus | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState(""); useEffect(() => { if (!selectedClient && clients[0]?.id) setSelectedClient(clients[0].id); }, [clients, selectedClient]);
  const load = () => {
    if (!selectedClient) return;
    setLoading(true); setError("");
    void pssApi<{ data?: KycStatus }>("/v1/kyc-status?client_id=" + encodeURIComponent(selectedClient))
      .then((response) => setResult(response.data ?? null))
      .catch((caught) => { setResult(null); setError(getPssErrorDetails(caught, "KYC status is temporarily unavailable.").message); })
      .finally(() => setLoading(false));
  };
  const previewAction = async (action: "approve" | "reject") => {
    setActionStatus("Validating action…");
    const response = await fetch("/api/clients/kyc/action-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, clientId: selectedClient, notes: "QA dry-run review" }) });
    const payload = await response.json() as { message?: string; error?: { user_safe_message?: string } };
    setActionStatus(payload.message || payload.error?.user_safe_message || "The KYC action could not be validated.");
  };
  // The read is intentionally triggered when the assigned-client selector changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selectedClient]);
  return <div className="space-y-6">
    <header><p className="text-xs font-medium text-primary">My Clients</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">KYC status</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Read-only approval status for assigned clients. Sensitive identity values are never displayed in this workspace.</p></header>
    <section className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"><label htmlFor="kyc-client" className="text-xs font-semibold">Assigned client</label><select id="kyc-client" value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)} disabled={!clients.length} className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm sm:min-w-72">{!clients.length && <option value="">No assigned clients</option>}{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></section>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"><span>{error}</span><button type="button" onClick={load} disabled={loading} className="min-h-11 rounded border border-destructive/30 px-2 font-semibold">Retry</button></div>}
    {!selectedClient && <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No assigned client is available for KYC status.</p>}
    {selectedClient && <section className="rounded-xl border border-border/70 bg-card p-5 shadow-xs"><div className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary">{result?.approved ? <ShieldCheck className="size-5" /> : <ShieldX className="size-5" />}</div><div><h2 className="text-sm font-semibold">Approval status</h2><p className="mt-1 text-2xl font-semibold capitalize">{loading ? "Checking…" : result?.status?.replaceAll("_", " ") ?? "Unavailable"}</p><p className="mt-2 text-xs text-muted-foreground">{result?.approved ? "The assigned client has completed the required KYC checks." : "The assigned client is not currently approved for all required checks."}</p></div></div>{!loading && result?.missing_fields?.length ? <div className="mt-5 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><span className="font-semibold">Missing checks:</span> {result.missing_fields.join(", ")}</div> : null}<div className="mt-5 flex flex-wrap gap-2">{can("admin.clients.kyc.approve") && <button type="button" onClick={() => void previewAction("approve")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold">Preview approval</button>}{can("admin.clients.kyc.reject") && <button type="button" onClick={() => void previewAction("reject")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold">Preview rejection</button>}<button type="button" onClick={load} disabled={loading} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold disabled:opacity-50"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />{loading ? "Refreshing…" : "Refresh status"}</button></div>{actionStatus && <p role="status" className="mt-3 text-xs text-muted-foreground">{actionStatus}</p>}</section>}
  </div>;
}
