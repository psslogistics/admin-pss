import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/dashboard/operations-workspace.tsx", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes report export", /admin\.reports\.export/],
  ["worker maps report export scope", /reports\.export[\s\S]*admin\.reports\.export/],
  ["worker retains report read gate", /route === "\/reports\/shipments"[\s\S]*hasScope\(auth, "reports\.read"\)/],
  ["worker gates CSV export", /exportRequested[\s\S]*Report export permission required/],
  ["worker scopes exported detail rows", /details\.results\.map[\s\S]*columns\.map/],
  ["UI gates export control", /can\("admin\.reports\.export"\)/],
  ["UI downloads server-generated CSV", /format=csv[\s\S]*createObjectURL[\s\S]*download/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}\n${ui}`, pattern, label);
console.log(`employee-report-export-contract: ${checks.length}/${checks.length} passed`);
