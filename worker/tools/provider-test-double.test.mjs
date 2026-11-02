import test from "node:test";
import assert from "node:assert/strict";
import { providerTestDouble } from "../src/provider-test-double.ts";

test("staging provider double returns synchronous LR and AWB", () => {
  const result = providerTestDouble("shipments", { shipment_id: "handover-test-1" });
  assert.equal(result.status, "accepted");
  assert.equal(result.providerPending, false);
  assert.match(result.lr_number, /^98\d{8}$/);
  assert.match(result.master_awb, /^990\d{10}$/);
});

test("staging provider double supplies serviceability and pickup results", () => {
  assert.equal(providerTestDouble("serviceability", {}).serviceable, true);
  const pickup = providerTestDouble("pickups", { pickup_id: "pickup-1", requested_date: "2030-01-02" });
  assert.equal(pickup.status, "accepted");
  assert.equal(pickup.acceptedDate, "2030-01-02");
  assert.match(pickup.providerReference, /^TEST-PICKUP-/);
});

test("unknown provider operations never fabricate a response", () => {
  assert.equal(providerTestDouble("labels", { shipment_id: "handover-test-1" }), null);
});
