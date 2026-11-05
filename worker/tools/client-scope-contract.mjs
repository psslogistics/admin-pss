import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const checks = [
  ["client access helper is assignment-based", /function canAccessClient\(auth: Auth, clientId: string\) \{ return auth\.system \|\| auth\.clientIds\.has\(clientId\); \}/],
  ["test data is hidden for client-facing auth", /function hidesClientTestData\(auth: Auth\)[\s\S]*auth\.kind === "api"[\s\S]*auth\.audience === "client"/],
  ["shipment list binds assigned client IDs", /const clientWhere = \[`s\.client_id IN \(\$\{\[\.\.\.auth\.clientIds\]/],
  ["shipment detail rechecks client access", /if \(!shipment \|\| !canAccessClient\(auth, shipment\.client_id\)\)/],
  ["pickup list binds assigned client IDs", /SELECT \$\{pickupColumns\} FROM pickup_requests WHERE client_id IN \(\$\{\[\.\.\.auth\.clientIds\]/],
  ["billing list binds assigned client IDs", /WHERE b\.client_id IN \(\$\{\[\.\.\.auth\.clientIds\]/],
  ["wallet list binds assigned client IDs", /FROM wallet_transactions WHERE client_id IN \(\$\{clientIds\.map\(\(\) => "\?"\)/],
  ["related wallet records hide test shipments", /table === "wallet_transactions"\) return `NOT EXISTS \(SELECT 1 FROM shipments test_shipment/],
];
const passed = checks.filter(([, pattern]) => pattern.test(source)).length;
for (const [label, pattern] of checks) console.log(`${pattern.test(source) ? "PASS" : "FAIL"}: ${label}`);
assert.equal(passed, checks.length, `Client scope contract failed: ${passed}/${checks.length}`);
console.log(`Client scope contract checks passed (${passed} checks).`);
