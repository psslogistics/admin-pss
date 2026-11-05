import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes security view", /admin\.security\.view/],
  ["catalogue exposes session revoke", /admin\.security\.session_revoke/],
  ["worker maps security view", /security\.view[\s\S]*admin\.security\.view/],
  ["worker maps session revoke", /security\.session_revoke[\s\S]*admin\.security\.session_revoke/],
  ["session list requires permission", /route === "\/security\/sessions" && request\.method === "GET"[\s\S]*hasScope\(auth, "security\.view"\)/],
  ["session revoke requires permission", /securitySessionRevoke && request\.method === "POST"[\s\S]*hasScope\(auth, "security\.session_revoke"\)/],
  ["revoke remains current-session-only", /expectedSessionId[\s\S]*securitySessionRevoke\[1\] !== expectedSessionId/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}`, pattern, label);
console.log(`employee-security-session-contract: ${checks.length}/${checks.length} passed`);
