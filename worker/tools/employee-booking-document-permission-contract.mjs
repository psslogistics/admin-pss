import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/dashboard/operations-workspace.tsx", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes booking document permission", /admin\.bookings\.documents\.manage/],
  ["worker maps booking document scope", /bookings\.documents\.manage[\s\S]*admin\.bookings\.documents\.manage/],
  ["staged invoice route requires booking document permission", /shipments\/documents\/stage[\s\S]*Booking document permission required/],
  ["document upload route requires booking document permission", /route === "\/documents"[\s\S]*Booking document permission required/],
  ["document upload remains client-scoped", /requireClient\(auth, payload\.client_id\)[\s\S]*canAccessClient\(auth, clientId\)/],
  ["document upload remains idempotent", /POST \/v1\/documents[\s\S]*idempotentResponse/],
  ["booking UI owns the document upload flow", /booking\.invoices[\s\S]*\/v1\/documents/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}\n${ui}`, pattern, label);
console.log(`employee-booking-document-permission-contract: ${checks.length}/${checks.length} passed`);
