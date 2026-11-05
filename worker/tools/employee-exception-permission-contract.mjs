import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes exception assignment", /admin\.exceptions\.assign/],
  ["catalogue exposes exception resolution", /admin\.exceptions\.resolve/],
  ["worker maps both case scopes", /exceptions\.assign[\s\S]*admin\.exceptions\.assign[\s\S]*exceptions\.resolve[\s\S]*admin\.exceptions\.resolve/],
  ["case assignment is permission-gated", /caseEntity && payload\.assigned_to_user_id !== undefined[\s\S]*Exception assignment permission required/],
  ["case resolution is permission-gated", /caseEntity && \["resolved", "closed"\][\s\S]*Exception resolution permission required/],
  ["broad case management remains compatible", /\["exceptions\.assign", "cases\.manage"\][\s\S]*\["exceptions\.resolve", "cases\.manage"\]/],
  ["case mutations retain client scope, idempotency, and audit", /canAccessClient\(auth, current\.client_id\)[\s\S]*idempotentResponse\(env, idempotencyKey, current\.client_id[\s\S]*\.updated/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-exception-permission-contract: ${checks.length}/${checks.length} passed`);
