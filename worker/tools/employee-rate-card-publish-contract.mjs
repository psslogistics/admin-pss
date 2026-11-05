import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes rate-card publish", /admin\.rate_cards\.publish/],
  ["pricing publish maps rate-card publish", /pricing\.publish[\s\S]*admin\.rate_cards\.publish/],
  ["pincode publication remains Super Admin-only", /pincodeDatasetPublish[\s\S]*hasRole\(auth, \["super_admin"\]\)[\s\S]*pricing\.publish/],
  ["pricing version publication remains Super Admin-only", /pricingVersionPublish[\s\S]*hasRole\(auth, \["super_admin"\]\)[\s\S]*pricing\.publish/],
  ["publication remains idempotent", /pricing\/versions\/\$\{version\.id\}\/publish[\s\S]*idempotentResponse/],
  ["publication is audited", /pricing\.version_published/],
  ["draft validation remains before publication", /version\.status !== "draft"/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-rate-card-publish-contract: ${checks.length}/${checks.length} passed`);
