import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../../app/dashboard/rate-cards/page.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../../app/api/rate-cards/route.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../../components/dashboard/employee-rate-cards-client.tsx", import.meta.url), "utf8");

const checks = [
  ["page route requires view permission", /requireEmployeePermission\("admin\.rate_cards\.view"\)/],
  ["API list requires view permission", /access\(undefined, "admin\.rate_cards\.view"\)/],
  ["API upload requires manage permission", /export async function POST[\s\S]*access\(clientId\)/],
  ["API download requires manage permission", /export async function PATCH[\s\S]*access\(clientId\)/],
  ["API enforces assigned-client scope", /employee_client_assignments[\s\S]*RATE_CARD_CLIENT_SCOPE_DENIED/],
  ["client handles safe list failures", /Rate cards are unavailable; no empty state is being shown/],
  ["client exposes retry and download actions", /Retry rate cards[\s\S]*Download/],
];

for (const [label, pattern] of checks) assert.match(`${page}\n${route}\n${client}`, pattern, label);
console.log(`employee-rate-card-parity-contract: ${checks.length}/${checks.length} passed`);
