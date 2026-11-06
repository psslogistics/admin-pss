import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("../../app/api/clients/kyc/action-preview/route.ts", import.meta.url), "utf8");
const ui = await readFile(new URL("../../components/dashboard/employee-kyc.tsx", import.meta.url), "utf8");
const checks = [
  ["route checks authentication", /getClaims\(\)[\s\S]*AUTHENTICATION_REQUIRED/],
  ["route validates only approve or reject", /new Set\(\["approve", "reject"\]\)/],
  ["route checks the action permission", /permissionByAction[\s\S]*admin\.clients\.kyc\.approve[\s\S]*admin\.clients\.kyc\.reject/],
  ["route enforces assigned client scope", /assignedClientIds\.includes\(clientId\)/],
  ["route is mutation-free", /dryRun: true[\s\S]*mutationSubmitted: false[\s\S]*auditEventCreated: false/],
  ["UI gates approval preview", /can\("admin\.clients\.kyc\.approve"\)[\s\S]*Preview approval/],
  ["UI gates rejection preview", /can\("admin\.clients\.kyc\.reject"\)[\s\S]*Preview rejection/],
];
for (const [label, pattern] of checks) assert.match(route + "\n" + ui, pattern, label);
console.log("employee-kyc-action-preview-contract: " + checks.length + "/" + checks.length + " passed");
