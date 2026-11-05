"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, WalletCards } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";

type WalletRow = {
  id: string;
  client_id: string;
  type?: string | null;
  amount?: number | string | null;
  balance_after?: number | string | null;
  reference?: string | null;
  status?: string | null;
  created_at?: string | null;
};

const money = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount) : "Amount unavailable";
};

export default function EmployeeWallet() {
  const { can, getVisibleClients } = useEmployee();
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const clients = getVisibleClients();
  const clientName = (id: string) => clients.find((client) => client.id === id)?.name ?? "Assigned client";

  const load = useCallback(async () => {
    if (!can("admin.wallet.view")) return;
    setLoading(true);
    setNotice("");
    try {
      const result = await pssApi<{ data?: WalletRow[] }>("/v1/wallet?limit=100");
      setRows(result.data ?? []);
    } catch (error) {
      setNotice(getPssErrorDetails(error, "Wallet activity is unavailable; no empty state is being shown.").message);
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => { void load(); }, [load]);

  if (!can("admin.wallet.view")) return null;

  return (
    <section className="rounded-xl border border-border/70 bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><WalletCards className="size-3.5" /> Wallet activity</div>
          <p className="mt-1 text-xs text-muted-foreground">Read-only transaction history for assigned clients. Wallet adjustments require a separate authorized control flow.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      {notice ? <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs text-destructive"><span>{notice}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div> : null}
      {loading ? <div className="p-6 text-sm text-muted-foreground">Loading wallet activity…</div> : rows.length ? <div className="divide-y divide-border/60">{rows.map((row) => <article key={row.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold">{row.reference || "Wallet transaction"}</p><p className="mt-1 text-xs text-muted-foreground">{clientName(row.client_id)} · {row.type || "activity"} · {row.status || "status unavailable"}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleString() : "Date unavailable"}</p></div><div className="text-left sm:text-right"><p className="text-sm font-semibold">{money(row.amount)}</p><p className="mt-1 text-[11px] text-muted-foreground">Balance after: {money(row.balance_after)}</p></div></article>)}</div> : <div className="p-6 text-sm text-muted-foreground">No wallet activity for the assigned client scope.</div>}
    </section>
  );
}
