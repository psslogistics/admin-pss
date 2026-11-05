import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes audit export", /admin\.audit\.export/],
  ["worker maps audit export scope", /audit\.export[\s\S]*admin\.audit\.export/],
  ["activity read remains guarded", /route === "\/activity" && request\.method === "GET"[\s\S]*activity\.read/],
  ["CSV export requires audit export", /exportRequested[\s\S]*Audit export permission required/],
  ["export is scoped to the activity query", /scopedSql[\s\S]*exportRequested[\s\S]*const columns/],
  ["export contains safe audit columns", /actor_user_id[\s\S]*entity_type[\s\S]*created_at/],
  ["export has a deterministic filename", /audit-log-\$\{new Date\(\)\.toISOString\(\)\.slice\(0, 10\)\}/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-audit-export-contract: ${checks.length}/${checks.length} passed`);
