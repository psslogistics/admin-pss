export type CloudflareUsageState = "healthy" | "watch" | "alert" | "critical" | "not_configured" | "error";

export type CloudflareUsageSnapshot = {
  provider: "cloudflare";
  database_id: string;
  billing_period_start: string;
  billing_period_end: string;
  rows_read: number;
  rows_written: number;
  included_rows_read: number;
  included_rows_written: number;
  read_percent: number;
  write_percent: number;
  read_excess: number;
  write_excess: number;
  estimated_cost_usd: number;
  projected_rows_read: number;
  projected_cost_usd: number;
  state: CloudflareUsageState;
  threshold_percent: number;
  last_synced_at: string | null;
  source: "cloudflare_graphql" | "not_configured" | "error";
  message?: string;
};

type Env = {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_D1_DATABASE_ID?: string;
};

const READ_ALLOWANCE = 25_000_000_000;
const WRITE_ALLOWANCE = 50_000_000;
const READ_RATE_PER_MILLION = 0.001;
const WRITE_RATE_PER_MILLION = 1;

let cached: { expiresAt: number; snapshot: CloudflareUsageSnapshot } | null = null;

function period(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stateFor(readPercent: number, writePercent: number): { state: CloudflareUsageState; threshold: number } {
  const percent = Math.max(readPercent, writePercent);
  if (percent >= 98) return { state: "critical", threshold: 98 };
  if (percent >= 90) return { state: "alert", threshold: 90 };
  if (percent >= 75) return { state: "watch", threshold: 75 };
  return { state: "healthy", threshold: percent >= 50 ? 50 : 0 };
}

function notConfigured(message: string, databaseId = ""): CloudflareUsageSnapshot {
  const dates = period();
  return {
    provider: "cloudflare", database_id: databaseId, billing_period_start: dates.start, billing_period_end: dates.end,
    rows_read: 0, rows_written: 0, included_rows_read: READ_ALLOWANCE, included_rows_written: WRITE_ALLOWANCE,
    read_percent: 0, write_percent: 0, read_excess: 0, write_excess: 0, estimated_cost_usd: 0,
    projected_rows_read: 0, projected_cost_usd: 0, state: "not_configured", threshold_percent: 0,
    last_synced_at: null, source: "not_configured", message,
  };
}

export async function readCloudflareD1Usage(env: Env, now = new Date()): Promise<CloudflareUsageSnapshot> {
  const accountTag = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  const databaseId = env.CLOUDFLARE_D1_DATABASE_ID?.trim();
  if (!accountTag || !token || !databaseId) return notConfigured("Cloudflare Analytics credentials are not configured on the API Worker.", databaseId ?? "");
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;

  const dates = period(now);
  const query = `query D1Usage($accountTag: String!, $start: Date!, $end: Date!, $databaseId: String!) {
    viewer { accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }) {
        sum { rowsRead rowsWritten readQueries writeQueries }
        dimensions { date databaseId }
      }
    } }
  }`;
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { accountTag, start: dates.start, end: dates.end, databaseId } }),
    });
    const body = await response.json() as { errors?: Array<{ message?: string }>; data?: { viewer?: { accounts?: Array<{ d1AnalyticsAdaptiveGroups?: Array<{ sum?: { rowsRead?: unknown; rowsWritten?: unknown } }> }> } } };
    if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).filter(Boolean).join("; ") || `Cloudflare returned HTTP ${response.status}`);
    const groups = body.data?.viewer?.accounts?.flatMap((account) => account.d1AnalyticsAdaptiveGroups ?? []) ?? [];
    const rowsRead = groups.reduce((total, group) => total + numberValue(group.sum?.rowsRead), 0);
    const rowsWritten = groups.reduce((total, group) => total + numberValue(group.sum?.rowsWritten), 0);
    const readPercent = rowsRead / READ_ALLOWANCE * 100;
    const writePercent = rowsWritten / WRITE_ALLOWANCE * 100;
    const readExcess = Math.max(0, rowsRead - READ_ALLOWANCE);
    const writeExcess = Math.max(0, rowsWritten - WRITE_ALLOWANCE);
    const elapsed = Math.max(1, now.getUTCDate());
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projectedRowsRead = Math.round(rowsRead / elapsed * daysInMonth);
    const estimatedCostUsd = readExcess / 1_000_000 * READ_RATE_PER_MILLION + writeExcess / 1_000_000 * WRITE_RATE_PER_MILLION;
    const projectedReadExcess = Math.max(0, projectedRowsRead - READ_ALLOWANCE);
    const projectedCostUsd = projectedReadExcess / 1_000_000 * READ_RATE_PER_MILLION + writeExcess / 1_000_000 * WRITE_RATE_PER_MILLION;
    const state = stateFor(readPercent, writePercent);
    const snapshot: CloudflareUsageSnapshot = {
      provider: "cloudflare", database_id: databaseId, billing_period_start: dates.start, billing_period_end: dates.end,
      rows_read: rowsRead, rows_written: rowsWritten, included_rows_read: READ_ALLOWANCE, included_rows_written: WRITE_ALLOWANCE,
      read_percent: readPercent, write_percent: writePercent, read_excess: readExcess, write_excess: writeExcess,
      estimated_cost_usd: estimatedCostUsd, projected_rows_read: projectedRowsRead, projected_cost_usd: projectedCostUsd,
      state: state.state, threshold_percent: state.threshold, last_synced_at: new Date().toISOString(), source: "cloudflare_graphql",
    };
    cached = { expiresAt: Date.now() + 5 * 60_000, snapshot };
    return snapshot;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Cloudflare Analytics request failed";
    const snapshot = notConfigured(`Cloudflare usage could not be refreshed: ${message}`, databaseId);
    snapshot.state = "error";
    snapshot.source = "error";
    return snapshot;
  }
}
