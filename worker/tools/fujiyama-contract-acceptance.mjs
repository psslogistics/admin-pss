import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const documentation = await readFile(new URL("../FUJIYAMA_API.md", import.meta.url), "utf8");

const checks = [
  ["tracking route", source.includes('route === "/fujiyama/tracking"')],
  ["booking route", source.includes('route === "/fujiyama/bookings"')],
  ["tracking scope", source.includes('hasScope(auth, "tracking.read")')],
  ["booking scope", source.includes('hasScope(auth, "shipments.create")')],
  ["system API-key administration", source.includes("if (auth.system) return true;")],
  ["API-key tenant binding", source.includes("clientIds: new Set([row.client_id])")],
  ["canonical booking delegation", source.includes('route = "/shipments"')],
  ["persisted booking reference", source.includes("provider_reference FROM shipments WHERE id = ? AND client_id = ?")],
  ["tracking uses database lookup", source.includes("FROM shipments WHERE client_id = ? AND (tracking_number = ? OR provider_reference = ?)")],
  ["tracking refreshes Delhivery", (() => { const start = source.indexOf('route === "/fujiyama/tracking"'); const end = source.indexOf('route === "/fujiyama/bookings"', start); return start >= 0 && end > start && source.slice(start, end).includes('safeProviderRequest(env, "delhivery", "tracking"'); })()],
  ["tracking falls back to assigned Delhivery accounts", source.includes("No shipment found in PSS or the client’s active Delhivery accounts") && source.includes("FROM provider_accounts pa")],
  ["tracking returns provider status", source.includes("provider_status: providerResult.status")],
  ["tracking supports empty database", source.includes('found: false') && source.includes('events: []')],
  ["documentation contains both contracts", documentation.includes("/v1/fujiyama/tracking") && documentation.includes("/v1/fujiyama/bookings")],
  ["documentation names the two required scopes", documentation.includes("tracking.read") && documentation.includes("shipments.create")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Fujiyama contract checks failed: ${failed.join(", ")}`);
console.log(`Fujiyama contract checks passed (${checks.length} checks).`);
