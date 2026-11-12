import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [authServer, layout, provider] = await Promise.all([
  readFile(new URL("../../lib/auth/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/dashboard/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-provider.tsx", import.meta.url), "utf8"),
]);

const source = `${authServer}\n${layout}\n${provider}`;
const checks = [
  ["server actor exposes assigned client ids", /assignedClientIds/],
  ["server actor exposes assigned client cards", /assignedClients/],
  ["layout forwards assigned scope", /assignedClientIds: actor\.assignedClientIds/],
  ["provider accepts assigned client ids", /assignedClientIds\?: string\[\]/],
  ["provider accepts assigned client cards", /assignedClients\?: AssignedClient\[\]/],
  ["provider has an asynchronous assignment fallback", /queriedAssignedClientIds|queriedClients/],
];
for (const [label, pattern] of checks) assert.match(source, pattern, label);
console.log(`Employee async assigned-client contract passed (${checks.length} checks).`);
