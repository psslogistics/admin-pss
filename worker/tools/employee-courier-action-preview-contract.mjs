import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../../app/api/couriers/action-preview/route.ts", import.meta.url), "utf8");
const checks = [
  ["route checks authentication", /getClaims\(\)[\s\S]*AUTHENTICATION_REQUIRED/],
  ["route maps courier lifecycle permissions", /admin\.couriers\.create[\s\S]*admin\.couriers\.edit[\s\S]*admin\.couriers\.enable[\s\S]*admin\.couriers\.disable[\s\S]*admin\.couriers\.assign/],
  ["route validates account/provider requirements", /COURIER_ACTION_PAYLOAD_INVALID/],
  ["route enforces assigned client scope", /assignedClientIds\.includes\(clientId\)/],
  ["route blocks provider and secret side effects", /providerCalled: false[\s\S]*secretsAccepted: false[\s\S]*auditEventCreated: false/],
];
for (const [label, pattern] of checks) assert.match(route, pattern, label);
console.log(`Employee courier-action preview contract passed (${checks.length}/${checks.length} checks).`);
