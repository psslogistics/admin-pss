import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const permissions = await readFile(new URL("../../lib/admin-permissions.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20261113_employee_session_revocations.sql", import.meta.url), "utf8");
const shell = await readFile(new URL("../../components/dashboard/employee-shell.tsx", import.meta.url), "utf8");

const checks = [
  ["catalogue exposes security view", /admin\.security\.view/],
  ["catalogue exposes session revoke", /admin\.security\.session_revoke/],
  ["worker maps security view", /security\.view[\s\S]*admin\.security\.view/],
  ["worker maps session revoke", /security\.session_revoke[\s\S]*admin\.security\.session_revoke/],
  ["session list requires permission", /route === "\/security\/sessions" && request\.method === "GET"[\s\S]*hasScope\(auth, "security\.view"\)/],
  ["session revoke requires permission", /securitySessionRevoke && request\.method === "POST"[\s\S]*hasScope\(auth, "security\.session_revoke"\)/],
  ["revoke remains current-session-only", /expectedSessionId[\s\S]*securitySessionRevoke\[1\] !== expectedSessionId/],
  ["employee logout revocation table exists", /CREATE TABLE IF NOT EXISTS employee_session_revocations/],
  ["worker rejects revoked token hashes", /employee_session_revocations[\s\S]*if \(revoked\) return null/],
  ["employee shell revokes before global sign-out", /employee\/session\/revoke[\s\S]*signOut\(\{ scope: "global" \}\)/],
];

for (const [label, pattern] of checks) assert.match(`${permissions}\n${worker}\n${migration}\n${shell}`, pattern, label);
console.log(`employee-security-session-contract: ${checks.length}/${checks.length} passed`);
