import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes address view", /admin\.addresses\.view/],
  ["worker maps address read scope", /addresses\.read[\s\S]*admin\.addresses\.view/],
  ["address GET uses read permission", /route === "\/addresses" && request\.method === "GET"[\s\S]*hasScope\(auth, "addresses\.read"\)/],
  ["address collection uses read permission", /"\/addresses": \{ table: "client_addresses", scope: "addresses\.read"/],
  ["address writes remain management-gated", /route === "\/addresses"\) && request\.method === "POST"[\s\S]*hasScope\(auth, "addresses\.manage"\)/],
  ["address reads retain client scope", /client_id IN \(\$\{\[\.\.\.auth\.clientIds\]/],
  ["address read excludes test data when required", /const addressVisibility = testDataVisibilityClause\(auth\)/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-address-read-contract: ${checks.length}/${checks.length} passed`);
