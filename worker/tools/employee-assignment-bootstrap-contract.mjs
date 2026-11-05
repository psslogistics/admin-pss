import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [authServer, layout, provider] = await Promise.all([
  readFile(new URL("../../lib/auth/server.ts", import.meta.url), "utf8"),
  readFile(new URL("../../app/dashboard/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../../components/dashboard/employee-provider.tsx", import.meta.url), "utf8"),
]);

const checks = [
  ["server auth context exposes active client ids", authServer, /active_client_ids\?: string\[\]/],
  ["server actor returns assigned client ids", authServer, /assignedClientIds/],
  ["server actor returns assigned client cards", authServer, /assignedClients/],
  ["dashboard layout forwards assigned client ids", layout, /assignedClientIds: actor\.assignedClientIds/],
  ["dashboard layout forwards assigned client cards", layout, /assignedClients: actor\.assignedClients/],
  ["employee identity accepts assigned client ids", provider, /assignedClientIds\?: string\[\]/],
  ["employee identity accepts assigned client cards", provider, /assignedClients\?: AssignedClient\[\]/],
  ["employee profile initializes assigned scope", provider, /assignedClientIds: initialIdentity\.assignedClientIds \?\? \[\]/],
  ["browser assignment read has authoritative fallback", provider, /initialIdentity\?\.assignedClientIds\?\.length \? initialIdentity\.assignedClientIds : queriedAssignedClientIds/],
  ["browser client cards have authoritative fallback", provider, /queriedClients\.length \? queriedClients : \(initialIdentity\?\.assignedClients \?\? \[\]\)/],
];

for (const [label, source, pattern] of checks) {
  assert.match(source, pattern, label);
}

console.log(`Employee assignment bootstrap contract passed (${checks.length} checks).`);
