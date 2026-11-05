import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const rateCards = await readFile(new URL("../../app/api/rate-cards/route.ts", import.meta.url), "utf8");
const shell = await readFile(new URL("../../components/dashboard/employee-shell.tsx", import.meta.url), "utf8");

const checks = [
  ["Worker errors carry request IDs", /const error = .*request_id: requestId/s.test(worker)],
  ["Worker provider errors identify a safe provider category", /category === "provider"/s.test(worker)],
  ["Worker errors expose retryability and stale-data state", /retryable, stale_data: false/s.test(worker)],
  ["provider timeouts are normalized", /provider_timeout/s.test(worker)],
  ["provider failures preserve the shipment as an exception", /UPDATE shipments SET status = 'exception', provider_sync_status = 'failed'/s.test(worker)],
  ["provider failures write an audit event", /shipment\.provider_failed/s.test(worker)],
  ["booking failure responses remain idempotent", /failedResponse[\s\S]*saveIdempotent\(env, key, clientId/s.test(worker)],
  ["booking retry failure remains retryable", /Delhivery still did not accept this booking[\s\S]*retryable: true/s.test(worker)],
  ["rate-card failures return a user-safe message", /user_safe_message: userMessage/s.test(rateCards)],
  ["rate-card failures include request IDs", /"x-request-id": requestId/s.test(rateCards)],
  ["rate-card server failures are marked retryable", /retryable: status >= 500/s.test(rateCards)],
  ["support exposes a safe retry action for failed messages", /Retry messages/s.test(shell)],
];

const passed = checks.filter(([, ok]) => ok).length;
for (const [label, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
assert.equal(passed, checks.length, `Failure-state contract failed: ${passed}/${checks.length}`);
console.log(`Failure-state contract checks passed (${passed} checks).`);
