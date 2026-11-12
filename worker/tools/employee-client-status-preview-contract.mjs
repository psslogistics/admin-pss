import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../../app/api/clients/action-preview/route.ts", import.meta.url), "utf8");
const checks = [
  ["route checks authentication", /getClaims\(\)[\s\S]*AUTHENTICATION_REQUIRED/],
  ["route maps client status permissions", /admin\.clients\.activate[\s\S]*admin\.clients\.suspend/],
  ["route validates action and client", /CLIENT_ACTION_PAYLOAD_INVALID/],
  ["route enforces assigned client scope", /assignedClientIds\.includes\(clientId\)/],
  ["route is mutation-free", /dryRun: true[\s\S]*mutationSubmitted: false[\s\S]*auditEventCreated: false/],
];
for (const [label, pattern] of checks) assert.match(route, pattern, label);
console.log(`Employee client-status preview contract passed (${checks.length}/${checks.length} checks).`);
