import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/dashboard/workspace-page.tsx", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes granular task permissions", /admin\.tasks\.create[\s\S]*admin\.tasks\.edit[\s\S]*admin\.tasks\.complete[\s\S]*admin\.tasks\.assign/],
  ["UI gates task creation", /canCreate = can\("admin\.tasks\.create"\)/],
  ["UI gates task editing", /canEdit = can\("admin\.tasks\.edit"\)/],
  ["UI gates task completion", /canComplete = can\("admin\.tasks\.complete"\)/],
  ["UI exposes assignment capability to the task action surface", /canAssign = can\("admin\.tasks\.assign"\)/],
  ["worker maps granular task scopes", /tasks\.create[\s\S]*admin\.tasks\.create[\s\S]*tasks\.edit[\s\S]*admin\.tasks\.edit[\s\S]*tasks\.complete[\s\S]*admin\.tasks\.complete[\s\S]*tasks\.assign[\s\S]*admin\.tasks\.assign/],
  ["worker gates POST with create or legacy manage", /hasAnyScope\(auth, \["tasks\.create", "tasks\.manage"\]\)/],
  ["worker gates PATCH fields by operation", /needsEdit[\s\S]*tasks\.edit[\s\S]*needsCompletion[\s\S]*tasks\.complete[\s\S]*needsAssignment[\s\S]*tasks\.assign/],
  ["task writes retain idempotency and audit", /idempotentResponse[\s\S]*task\.created[\s\S]*task\.updated/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${ui}\n${worker}`, pattern, label);
console.log(`employee-task-permission-contract: ${checks.length}/${checks.length} passed`);
