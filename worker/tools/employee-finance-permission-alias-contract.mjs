import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const checks = [
  ["wallet view maps to the employee wallet read permission", /"wallet\.read": \["wallet\.read", "transactions\.view", "admin\.wallet\.view"\]/],
  ["wallet adjustment and approval map to the guarded finance mutation permission", /"wallet\.manage": \["wallet\.manage", "transactions\.manage", "admin\.wallet\.adjust", "admin\.wallet\.approve", "admin\.transactions\.reconcile"\]/],
  ["wallet GET remains permission-gated", /route === "\/wallet" && request\.method === "GET"[\s\S]*hasScope\(auth, "wallet\.read"\)/],
  ["wallet mutations remain administrator-gated", /route === "\/wallet"\) && request\.method === "POST"[\s\S]*hasScope\(auth, scope\)[\s\S]*hasRole\(auth, \["admin", "super_admin"\]\)/],
  ["finance mutations retain client scope", /const clientId = requireClient\(auth, payload\.client_id\)[\s\S]*canAccessClient\(auth, clientId\)/],
  ["finance mutations retain idempotency", /const key = request\.headers\.get\("Idempotency-Key"\)[\s\S]*idempotentResponse\(env, key, clientId, endpoint, requestHash\)/],
  ["finance mutations write audit events", /audit\(env, ctx, auth, id, `\$\{route\.slice\(1\)\}\.created`/],
];

for (const [label, pattern] of checks) assert.match(source, pattern, label);
console.log(`Employee finance permission alias contract passed (${checks.length} checks).`);
