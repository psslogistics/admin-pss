import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const billingBlock = source.match(/if \(route === "\/billing"[\s\S]*?if \(route === "\/weight-reconciliation"/)?.[0] ?? "";
const weightBlock = source.match(/if \(route === "\/weight-reconciliation"[\s\S]*?if \(route === "\/cod-remittances"/)?.[0] ?? "";
const employeeProjection = weightBlock.match(/const employeeColumns =[^\n]+/)?.[0] ?? "";
const checks = [
  ["billing route is present for scoped inspection", billingBlock.length > 0],
  ["employee billing block does not select provider cost or margin fields", !/provider_amount|provider_cost|\bmargin\b/.test(billingBlock)],
  ["weight employee projection excludes internal recovery amounts", employeeProjection.length > 0 && !/provider_recovery_amount|retained_recovery_amount|client_credit_amount/.test(employeeProjection)],
  ["weight internal recovery fields are separately projected", /const internalColumns =.*provider_recovery_amount.*retained_recovery_amount/.test(weightBlock)],
  ["internal margin route requires Super Admin and provider-cost scope", /route === "\/pricing\/internal\/margins"[\s\S]*hasRole\(auth, \["super_admin"\]\)[\s\S]*hasScope\(auth, "provider_cost\.view"\)/.test(source)],
  ["internal margin response contains provider amount and margin only in gated route", /route === "\/pricing\/internal\/margins"[\s\S]*provider_amount[\s\S]*AS margin/.test(source)],
];
const passed = checks.filter(([, ok]) => ok).length;
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
assert.equal(passed, checks.length, `Financial field privacy contract failed: ${passed}/${checks.length}`);
console.log(`Financial field privacy contract checks passed (${passed} checks).`);
