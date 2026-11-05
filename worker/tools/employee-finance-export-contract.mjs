import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes billing export", /admin\.billing\.export/],
  ["catalogue exposes transaction export", /admin\.transactions\.export/],
  ["worker maps billing export", /billing\.export[\s\S]*admin\.billing\.export/],
  ["worker maps transaction export", /transactions\.export[\s\S]*admin\.transactions\.export/],
  ["billing export is permission-gated", /route === "\/billing"[\s\S]*Billing export permission required/],
  ["wallet export is permission-gated", /route === "\/wallet"[\s\S]*Transaction export permission required/],
  ["finance export uses whitelisted columns", /invoice_number[\s\S]*balance_after[\s\S]*escapeCsv/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-finance-export-contract: ${checks.length}/${checks.length} passed`);
