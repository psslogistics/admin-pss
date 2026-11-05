import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes label view", /admin\.documents\.label\.view/],
  ["catalogue exposes label download", /admin\.documents\.label\.download/],
  ["worker maps label view", /documents\.label\.view[\s\S]*admin\.documents\.label\.view/],
  ["worker maps label download", /documents\.label\.download[\s\S]*admin\.documents\.label\.download/],
  ["artifact route derives operation", /shipmentArtifact[\s\S]*operation = kind === "lr-copy"/],
  ["label view is guarded", /artifactPermission[\s\S]*documents\.label\.view[\s\S]*Label permission required/],
  ["guard precedes provider work", /Label permission required[\s\S]*requestedSize[\s\S]*safeProviderRequest/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-label-permission-contract: ${checks.length}/${checks.length} passed`);
