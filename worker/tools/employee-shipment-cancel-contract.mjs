import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes shipment cancellation", /admin\.shipments\.cancel/],
  ["worker maps shipment cancellation scope", /shipments\.cancel[\s\S]*admin\.shipments\.cancel/],
  ["cancellation is checked only for the cancellation transition", /status === "cancelled"[\s\S]*Shipment cancellation permission required/],
  ["legacy shipment-create scope remains compatible", /\["shipments\.cancel", "shipments\.create"\]/],
  ["client self-cancellation remains distinct", /status === "cancelled" && !clientActor/],
  ["shipment update retains client scope and idempotency", /canAccessClient\(auth, current\.client_id\)[\s\S]*idempotentResponse\(env, key, current\.client_id/],
  ["shipment cancellation is audited", /shipment\.updated[\s\S]*activitySnapshotPair/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-shipment-cancel-contract: ${checks.length}/${checks.length} passed`);
