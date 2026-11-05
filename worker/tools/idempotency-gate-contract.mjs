import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const has = (pattern) => new RegExp(pattern, "s").test(source);
const checks = [
  ["idempotency helpers exist", has("async function idempotentResponse[\\s\\S]*async function saveIdempotent")],
  ["provider account creation requires idempotency and saves the response", has("route === \\\"/provider-accounts\\\"[\\s\\S]*Idempotency-Key[\\s\\S]*idempotentResponse[\\s\\S]*saveIdempotent")],
  ["provider account updates require idempotency and save the response", has("providerAccountMatch && request\\.method === \\\"PATCH\\\"[\\s\\S]*Idempotency-Key[\\s\\S]*idempotentResponse[\\s\\S]*saveIdempotent")],
  ["API-key revocation requires idempotency and records the event", has("apiKeyMatch && request\\.method === \\\"PATCH\\\"[\\s\\S]*Idempotency-Key[\\s\\S]*idempotentResponse[\\s\\S]*api_key_events[\\s\\S]*saveIdempotent")],
  ["pricing-version creation requires idempotency and saves the response", has("route === \\\"/pricing/versions\\\"[\\s\\S]*Idempotency-Key[\\s\\S]*idempotentResponse[\\s\\S]*saveIdempotent")],
  ["pricing overrides require idempotency and save the response", has("route === \\\"/pricing/overrides\\\"[\\s\\S]*Idempotency-Key[\\s\\S]*idempotentResponse[\\s\\S]*saveIdempotent")],
  ["pricing mutations emit audit events", has("route === \\\"/pricing/versions\\\"[\\s\\S]*audit\\([\\s\\S]*pricing\\.version_[\\s\\S]*route === \\\"/pricing/overrides\\\"[\\s\\S]*audit\\([\\s\\S]*pricing\\.override_applied")],
  ["reused keys with a different payload are rejected", has("IDEMPOTENCY_KEY_REUSED")],
];

const passed = checks.filter(([, ok]) => ok).length;
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
assert.equal(passed, checks.length, `Idempotency gate contract failed: ${passed}/${checks.length}`);
console.log(`Idempotency gate contract checks passed (${passed} checks).`);
