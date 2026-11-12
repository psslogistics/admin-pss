import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [worker, authServer] = await Promise.all([
  readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../../lib/auth/server.ts", import.meta.url), "utf8"),
]);
assert.match(worker, /if \(auth\.roles\.has\("employee"\)\) return false/);
assert.match(worker, /if \(\!hasScope\(auth,/);
assert.match(authServer, /if \(\!data\) redirect\('\/access-denied\?reason=permission'\)/);
console.log("Employee authorization fail-closed contract passed (3 checks).");
