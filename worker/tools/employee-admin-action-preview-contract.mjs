import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../../app/api/admin/action-preview/route.ts", import.meta.url), "utf8");
const checks = [
  ["route checks authentication", /getClaims\(\)[\s\S]*AUTHENTICATION_REQUIRED/],
  ["route maps automation and bulk booking permissions", /admin\.automation\.manage[\s\S]*admin\.automation\.run[\s\S]*admin\.bookings\.bulk_create/],
  ["route maps employee lifecycle permissions", /admin\.employees\.enable[\s\S]*admin\.employees\.reset_password[\s\S]*admin\.employees\.assign_role[\s\S]*admin\.employees\.assign_client[\s\S]*admin\.employees\.revoke_client/],
  ["route validates targets and client scope", /ADMIN_ACTION_PAYLOAD_INVALID[\s\S]*ADMIN_ACTION_CLIENT_SCOPE_DENIED/],
  ["route is mutation-free", /mutationSubmitted: false[\s\S]*providerCalled: false[\s\S]*passwordChanged: false[\s\S]*scheduleCreated: false[\s\S]*auditEventCreated: false/],
];
for (const [label, pattern] of checks) assert.match(route, pattern, label);
console.log(`Employee admin-action preview contract passed (${checks.length}/${checks.length} checks).`);
