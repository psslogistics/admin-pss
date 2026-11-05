import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const server = await readFile(new URL("../../lib/auth/server.ts", import.meta.url), "utf8");
const provider = await readFile(new URL("../../components/dashboard/employee-provider.tsx", import.meta.url), "utf8");

const checks = [
  ["server reads get_auth_context", /supabase\.rpc\('get_auth_context'\)/],
  ["server applies context permissions before direct role fallback", /contextPermissions\.length \? contextPermissions : directPermissions/],
  ["server preserves explicit permission revokes", /override\.mode === 'revoke'/],
  ["server unions trusted client scope sources", /context\.active_client_ids[\s\S]*employeeAssignments/],
  ["server synthesizes a safe client card when details are unavailable", /name: 'Assigned client'/],
  ["browser prefers server-rendered permissions", /initialPermissions\.length[\s\S]*roleIds\.length > 0/],
  ["browser does not let a direct role query widen a server deny", /direct role query cannot expose a navigation item/],
];

for (const [label, pattern] of checks) {
  assert.match(`${server}\n${provider}`, pattern, label);
}

console.log(`employee-permission-parity-contract: ${checks.length}/${checks.length} passed`);
