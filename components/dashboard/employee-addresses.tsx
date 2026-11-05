"use client";

import { useCallback, useEffect, useState } from "react";
import { MapPin, RefreshCw } from "lucide-react";
import { useEmployee } from "@/components/dashboard/employee-provider";
import { getPssErrorDetails, pssApi } from "@/lib/pss-api";

type Address = {
  id: string;
  client_id: string;
  label?: string | null;
  address_kind?: string | null;
  contact_name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
};

export default function EmployeeAddresses({ clientId }: { clientId?: string }) {
  const { can } = useEmployee();
  const [rows, setRows] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!can("admin.addresses.view")) return;
    setLoading(true);
    setNotice("");
    try {
      const result = await pssApi<{ data?: Address[] }>("/v1/addresses?limit=200");
      setRows((result.data ?? []).filter((row) => !clientId || row.client_id === clientId));
    } catch (error) {
      setNotice(getPssErrorDetails(error, "Saved addresses are unavailable; no empty state is being shown.").message);
    } finally {
      setLoading(false);
    }
  }, [can, clientId]);

  useEffect(() => { void load(); }, [load]);

  if (!can("admin.addresses.view")) return null;

  return (
    <section className="rounded-xl border border-border/70 bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary"><MapPin className="size-3.5" /> Saved addresses</div>
          <p className="mt-1 text-xs text-muted-foreground">Assigned-client addresses only. Address changes are not available in the employee workspace.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-50"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
      </div>
      {notice ? <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-5 py-3 text-xs text-destructive"><span>{notice}</span><button type="button" onClick={() => void load()} className="font-semibold underline">Retry</button></div> : null}
      {loading ? <div className="p-6 text-sm text-muted-foreground">Loading saved addresses…</div> : rows.length ? <div className="grid gap-3 p-4 sm:grid-cols-2">{rows.map((row) => <article key={row.id} className="rounded-lg border border-border/60 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">{row.label || "Saved address"}</h3><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{row.address_kind || "location"}</p></div><MapPin className="size-4 shrink-0 text-primary" /></div><p className="mt-3 text-sm leading-5">{row.address || "Address line unavailable"}</p><p className="mt-1 text-xs text-muted-foreground">{[row.city, row.state, row.pincode, row.country].filter(Boolean).join(", ") || "Location details unavailable"}</p>{row.contact_name ? <p className="mt-2 text-xs text-muted-foreground">Contact: {row.contact_name}</p> : null}</article>)}</div> : <div className="p-6 text-sm text-muted-foreground">No saved addresses for this assigned client.</div>}
    </section>
  );
}
