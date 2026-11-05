import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes shipment edit", /admin\.shipments\.edit/],
  ["catalogue exposes tracking intervene", /admin\.tracking\.intervene/],
  ["worker maps shipment edit", /shipments\.edit[\s\S]*admin\.shipments\.edit/],
  ["worker maps tracking intervene", /tracking\.intervene[\s\S]*admin\.tracking\.intervene/],
  ["shipment patch is edit-gated", /shipmentUpdate && request\.method === "PATCH"[\s\S]*Shipment edit permission required/],
  ["tracking post is intervention-gated", /trackingPost && request\.method === "POST"[\s\S]*Tracking intervention permission required/],
  ["shipment mutations retain audit and idempotency", /shipment\.updated[\s\S]*saveIdempotent/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-shipment-intervention-contract: ${checks.length}/${checks.length} passed`);
