import test from "node:test";
import assert from "node:assert/strict";
import { providerAmountForBookingResult } from "../src/provider-cost-amount.ts";

test("failed provider result cannot be recorded as a zero cost", () => {
  assert.equal(providerAmountForBookingResult({ status: "failed", amount: 0 }), null);
});

test("an accepted explicit zero remains a valid provider cost", () => {
  assert.equal(providerAmountForBookingResult({ status: "accepted", amount: 0 }), 0);
});

test("missing, malformed, and negative costs remain unresolved", () => {
  assert.equal(providerAmountForBookingResult({ status: "accepted" }), null);
  assert.equal(providerAmountForBookingResult({ status: "accepted", amount: "not-a-number" }), null);
  assert.equal(providerAmountForBookingResult({ status: "accepted", amount: -1 }), null);
});
