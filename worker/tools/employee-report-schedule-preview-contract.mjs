import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [route, page] = await Promise.all([
  readFile(new URL("../../app/api/reports/schedule/preview/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/operations-workspace.tsx", import.meta.url), "utf8"),
]);
const source = `${route}\n${page}`;
const checks = [
  ["preview requires authenticated employee access", /requireEmployeeAccess\(\)/],
  ["preview checks schedule permission", /admin\.reports\.schedule/],
  ["preview validates payload", /REPORT_SCHEDULE_PAYLOAD_INVALID/],
  ["preview enforces client scope", /REPORT_SCHEDULE_CLIENT_SCOPE_DENIED/],
  ["preview never creates a schedule", /scheduleCreated: false/],
  ["preview never starts delivery", /externalDeliveryStarted: false/],
  ["UI labels preview as non-mutating", /Nothing will be scheduled or sent/],
];
for (const [label, pattern] of checks) assert.match(source, pattern, label);
console.log(`Employee report-schedule preview contract passed (${checks.length} checks).`);
