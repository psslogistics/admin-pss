"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { getPssErrorDetails, pssApi, type PssErrorDetails } from "@/lib/pss-api";

type ProviderState = {
  health?: string;
  configured?: boolean;
  enabled?: boolean;
  webhook_configured?: boolean;
  last_error_code?: string | null;
  last_checked_at?: string | null;
  activation_blockers?: string[];
  capabilities?: string[];
};

type ProviderAccount = {
  id: string;
  provider?: string;
  account_name?: string;
  status?: string;
  configured?: boolean;
  enabled?: boolean;
  explicitly_configured?: boolean;
  priority?: number;
  confidence_score?: number;
  capabilities?: string[];
};

type RequestError = PssErrorDetails & { operation: string };

const label = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());

export default function ProviderHealth({ clientId }: { clientId: string }) {
  const [providers, setProviders] = useState<Record<string, ProviderState>>({});
  const [accounts, setAccounts] = useState<ProviderAccount[]>([]);
  const [providerError, setProviderError] = useState<RequestError | null>(null);
  const [accountError, setAccountError] = useState<RequestError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The refresh key intentionally resets request state before synchronizing with the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setProviderError(null);
    setAccountError(null);
    const requests: [Promise<{ data: Record<string, ProviderState>; stale_data?: boolean }>, Promise<{ data: ProviderAccount[]; stale_data?: boolean }> | null] = [
      pssApi<{ data: Record<string, ProviderState>; stale_data?: boolean }>("/v1/provider-capabilities"),
      clientId ? pssApi<{ data: ProviderAccount[]; stale_data?: boolean }>(`/v1/provider-account-policies?client_id=${encodeURIComponent(clientId)}`) : null,
    ];
    void Promise.allSettled(requests).then(([providerResult, accountResult]) => {
      if (cancelled) return;
      let hasStaleData = false;
      if (providerResult.status === "fulfilled") {
        setProviders(providerResult.value.data ?? {});
        hasStaleData ||= providerResult.value.stale_data === true;
      } else {
        const details = getPssErrorDetails(providerResult.reason, "Provider health could not be loaded.");
        setProviderError({ ...details, operation: "provider health" });
      }
      if (accountResult === null) {
        setAccounts([]);
      } else if (accountResult.status === "fulfilled") {
        setAccounts(accountResult.value?.data ?? []);
        hasStaleData ||= accountResult.value?.stale_data === true;
      } else {
        const details = getPssErrorDetails(accountResult.reason, "Provider account assignments could not be loaded.");
        setAccountError({ ...details, operation: "provider account assignments" });
      }
      setStale(hasStaleData);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [clientId, reloadKey]);

  const providerEntries = Object.entries(providers);
  return <section className="space-y-4 rounded-xl border border-border/70 bg-card p-4 shadow-xs">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-primary" /> Provider operations health</div>
        <p className="mt-1 text-xs text-muted-foreground">Read-only readiness and account-assignment visibility for production courier operations.</p>
      </div>
      <button type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50"><RefreshCw className={loading ? "size-3.5 animate-spin" : "size-3.5"} />{loading ? "Checking…" : "Refresh health"}</button>
    </div>
    {stale && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Showing recently cached provider data. Refresh when the connection is available.</p>}
    {providerError && <ErrorState error={providerError} onRetry={() => setReloadKey((value) => value + 1)} />}
    {!providerError && loading && <p className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">Checking provider configuration and recent health…</p>}
    {!providerError && !loading && !providerEntries.length && <p className="rounded-lg border border-dashed border-border p-5 text-center text-xs text-muted-foreground">No provider health records were returned.</p>}
    {!!providerEntries.length && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{providerEntries.map(([provider, state]) => <ProviderCard key={provider} provider={provider} state={state} />)}</div>}
    {accountError ? <ErrorState error={accountError} onRetry={() => setReloadKey((value) => value + 1)} /> : clientId ? <AccountAssignments accounts={accounts} loading={loading} /> : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">Select an assigned client to inspect courier account assignments.</p>}
  </section>;
}

function ProviderCard({ provider, state }: { provider: string; state: ProviderState }) {
  const health = state.health ?? "unknown";
  const healthy = health === "healthy" && state.enabled === true;
  const blocked = !state.configured || state.enabled === false || (state.activation_blockers?.length ?? 0) > 0;
  const Icon = healthy ? CheckCircle2 : blocked ? XCircle : health === "degraded" ? AlertTriangle : CircleHelp;
  const tone = healthy ? "text-emerald-600" : blocked ? "text-destructive" : health === "degraded" ? "text-amber-600" : "text-muted-foreground";
  return <article className="rounded-lg border border-border/70 p-3">
    <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><Icon className={`size-4 ${tone}`} /><h3 className="text-sm font-semibold capitalize">{provider}</h3></div><span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold capitalize">{state.enabled ? health : state.configured ? "disabled" : "not configured"}</span></div>
    <dl className="mt-3 grid gap-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Provider calls</dt><dd className="font-medium">{state.enabled ? "Enabled" : "Unavailable"}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Webhooks</dt><dd className="font-medium">{state.webhook_configured ? "Configured" : "Not configured"}</dd></div>{state.last_checked_at && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Last checked</dt><dd className="font-medium">{formatDate(state.last_checked_at)}</dd></div>}</dl>
    {!!state.activation_blockers?.length && <div className="mt-3 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200"><span className="font-semibold">Needs attention:</span> {state.activation_blockers.map(label).join(", ")}</div>}
    {state.last_error_code && <p className="mt-2 text-[11px] text-destructive">Latest provider issue: {label(state.last_error_code)}</p>}
    {!!state.capabilities?.length && <p className="mt-2 text-[11px] text-muted-foreground">Capabilities: {state.capabilities.map(label).join(", ")}</p>}
  </article>;
}

function AccountAssignments({ accounts, loading }: { accounts: ProviderAccount[]; loading: boolean }) {
  return <div className="rounded-lg border border-border/70"><div className="border-b border-border/70 px-3 py-2"><h3 className="text-sm font-semibold">Selected client courier accounts</h3><p className="mt-1 text-xs text-muted-foreground">Only non-secret account metadata is shown. Disabled or unconfigured accounts cannot be used for booking.</p></div>{loading ? <p className="p-4 text-xs text-muted-foreground">Loading account assignments…</p> : accounts.length ? <div className="divide-y divide-border/70">{accounts.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3 text-xs"><div><p className="font-semibold">{account.account_name || "Unnamed account"}</p><p className="mt-1 text-muted-foreground">{(account.provider || "Unknown provider").toUpperCase()} · {account.capabilities?.map(label).join(", ") || "Capabilities not listed"}</p></div><div className="text-right"><p className={account.enabled ? "font-semibold text-emerald-600" : "font-semibold text-destructive"}>{account.enabled ? "Ready" : account.configured ? "Disabled" : "Not configured"}</p><p className="mt-1 text-muted-foreground">Priority {account.priority ?? "—"} · Confidence {account.confidence_score ?? 0}%</p></div></div>)}</div> : <p className="p-4 text-xs text-muted-foreground">No active courier account assignment was returned for this client.</p>}</div>;
}

function ErrorState({ error, onRetry }: { error: RequestError; onRetry: () => void }) {
  return <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"><div className="flex flex-wrap items-center justify-between gap-3"><span>{error.message} The rest of the health panel remains available.</span>{error.retryable && <button type="button" onClick={onRetry} className="rounded border border-destructive/30 px-2 py-1 font-semibold hover:bg-destructive/10">Retry {error.operation}</button>}</div><details className="mt-2"><summary className="cursor-pointer font-semibold">Technical details</summary><p className="mt-1 break-words">{error.technicalMessage}{error.providerCode ? ` · Provider code: ${error.providerCode}` : ""}{error.requestId ? ` · Request ID: ${error.requestId}` : ""}</p></details></div>;
}

function formatDate(value: string) { const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(timestamp); }
