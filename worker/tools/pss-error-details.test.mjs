import test from "node:test";
import assert from "node:assert/strict";
import { getPssErrorDetails } from "../../lib/pss-error-details.ts";

test("provider failures use the safe message and remain retryable", () => {
  const details = getPssErrorDetails({ status: 502, error: { category: "provider", user_safe_message: "The courier provider could not complete this operation.", technical_message: "HTTP 502 from courier", provider_code: "UPSTREAM_502", request_id: "req-provider", retryable: true, stale_data: false } });
  assert.equal(details.category, "provider");
  assert.equal(details.message, "The courier provider could not complete this operation.");
  assert.equal(details.retryable, true);
  assert.equal(details.requestId, "req-provider");
  assert.equal(details.providerCode, "UPSTREAM_502");
  assert.equal(details.staleData, false);
});

test("permission failures do not become retry prompts", () => {
  const details = getPssErrorDetails({ status: 403, error: { category: "permission", user_safe_message: "You do not have permission to complete this operation.", retryable: false } });
  assert.equal(details.category, "permission");
  assert.equal(details.retryable, false);
  assert.match(details.message, /permission/i);
});

test("expired sessions become an authentication message", () => {
  const details = getPssErrorDetails({ status: 401, error: { category: "auth", user_safe_message: "Your session has expired. Please sign in again." } });
  assert.equal(details.category, "auth");
  assert.equal(details.retryable, false);
  assert.match(details.message, /session has expired/i);
});

test("network and server failures preserve the safe existing-records message", () => {
  for (const status of [0, 500, 503]) {
    const details = getPssErrorDetails({ status, error: { category: status === 0 ? "network" : "server", technical_message: "database temporarily unavailable" } });
    assert.match(details.message, /temporarily unavailable/i);
    assert.equal(details.retryable, true);
    assert.equal(details.staleData, false);
  }
});

test("missing structured error data falls back without exposing a stack trace", () => {
  const details = getPssErrorDetails(new Error("internal stack-like detail"), "Records could not be loaded.");
  assert.match(details.message, /temporarily unavailable/i);
  assert.equal(details.message.includes("internal stack-like detail"), false);
  assert.equal(details.requestId, undefined);
  assert.equal(details.staleData, false);
});

test("retryability is honored when a provider explicitly forbids retry", () => {
  const details = getPssErrorDetails({ status: 502, error: { category: "provider", user_safe_message: "The request was rejected.", retryable: false, stale_data: false } });
  assert.equal(details.retryable, false);
});
