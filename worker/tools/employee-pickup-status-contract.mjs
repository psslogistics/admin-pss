import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes pickup cancellation", /admin\.pickup\.cancel/],
  ["catalogue exposes pickup status updates", /admin\.pickup\.update_status/],
  ["worker maps pickup mutation scopes", /pickups\.cancel[\s\S]*admin\.pickup\.cancel[\s\S]*pickups\.update_status[\s\S]*admin\.pickup\.update_status/],
  ["staff cancellation is permission-gated", /staffUpdate && payload\.status === "cancelled"[\s\S]*Pickup cancellation permission required/],
  ["staff status changes are permission-gated", /staffUpdate && payload\.status !== undefined[\s\S]*Pickup status permission required/],
  ["client cancellation remains separate", /clientCancel = !staffUpdate[\s\S]*hasScope\(auth, "pickups\.read"\)/],
  ["pickup mutations retain scope, idempotency, and audit", /canAccessClient\(auth, pickup\.client_id\)[\s\S]*idempotentResponse\(env, idempotencyKey, pickup\.client_id[\s\S]*pickup\.updated/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-pickup-status-contract: ${checks.length}/${checks.length} passed`);
