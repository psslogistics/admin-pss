import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes returns management", /admin\.returns\.manage/],
  ["worker maps returns scope", /returns\.manage[\s\S]*admin\.returns\.manage/],
  ["return creation is permission-gated", /hasAnyScope\(auth, \["returns\.manage", "cases\.manage"\]\)/],
  ["return updates are permission-gated", /entityUpdate\[1\] === "returns"[\s\S]*Returns management permission required/],
  ["return client scope remains enforced", /shipmentBelongsToClient\(env, payload\.shipment_id, clientId\)[\s\S]*canAccessClient\(auth, current\.client_id\)/],
  ["return mutations retain idempotency", /idempotentResponse\(env, key, clientId, "POST \/v1\/returns"/],
  ["return mutations are audited", /return\.created/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-returns-permission-contract: ${checks.length}/${checks.length} passed`);
