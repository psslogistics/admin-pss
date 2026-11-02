import test from "node:test";
import assert from "node:assert/strict";
import { isKycTestModeEnabled, isExplicitKycTestOrganization } from "../src/kyc-test-identity.ts";
import { providerTestDouble } from "../src/provider-test-double.ts";
import { STAGING_TEST_CLIENT, STAGING_TEST_SHIPMENT, assertStagingFixture } from "../src/staging-fixture.ts";

test("staging fixture is synthetic and production cannot activate it", () => {
  assertStagingFixture({ ...STAGING_TEST_CLIENT, shipment: STAGING_TEST_SHIPMENT });
  assert.equal(isKycTestModeEnabled("production", "true"), false);
  assert.equal(isKycTestModeEnabled("staging", "true"), true);
  assert.equal(
    isExplicitKycTestOrganization(
      [{ id: STAGING_TEST_CLIENT.id, identity_environment: STAGING_TEST_CLIENT.identity_environment }],
      [STAGING_TEST_CLIENT.id],
    ),
    true,
  );
});

test("staging booking contract returns immediate LR/AWB and keeps pickup separate", () => {
  const booking = providerTestDouble("shipments", { shipment_id: STAGING_TEST_SHIPMENT.id });
  assert.equal(booking.status, "accepted");
  assert.equal(booking.providerPending, false);
  assert.ok(booking.lr_number);
  assert.ok(booking.master_awb);

  const tracking = providerTestDouble("tracking", { shipment_id: STAGING_TEST_SHIPMENT.id });
  assert.equal(tracking.normalized_status, "in_transit");
  assert.equal(tracking.weight_kg, 20);

  const pickup = providerTestDouble("pickups", { pickup_id: `${STAGING_TEST_SHIPMENT.id}-pickup` });
  assert.equal(pickup.status, "accepted");
  assert.ok(pickup.providerReference);

  const freight = providerTestDouble("freight_charges", { shipment_id: STAGING_TEST_SHIPMENT.id });
  assert.equal(freight.provider_cost, 100);
});

test("staging error scenarios are deterministic and truthful", () => {
  const rejected = providerTestDouble("shipments", { shipment_id: "staging-rejected-test-only", test_scenario: "rejected" });
  assert.equal(rejected.status, "failed");
  assert.equal(rejected.code, "TEST_PROVIDER_REJECTED");
  assert.equal(rejected.retryable, false);

  const timeout = providerTestDouble("shipments", { shipment_id: "staging-timeout-test-only", test_scenario: "timeout" });
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.code, "TEST_PROVIDER_TIMEOUT");
  assert.equal(timeout.retryable, true);

  const pending = providerTestDouble("shipments", { shipment_id: "staging-pending-test-only", test_scenario: "missing_reference" });
  assert.equal(pending.status, "accepted");
  assert.equal(pending.providerPending, true);
  assert.equal(pending.lr_number, null);
  assert.equal(pending.master_awb, null);
  assert.ok(pending.providerBookingId);
});

test("repeated staging booking input produces the same provider identity", () => {
  const payload = { shipment_id: "staging-idempotency-test-only" };
  const first = providerTestDouble("shipments", payload);
  const second = providerTestDouble("shipments", payload);
  assert.deepEqual(
    { lr_number: first.lr_number, master_awb: first.master_awb, providerBookingId: first.providerBookingId },
    { lr_number: second.lr_number, master_awb: second.master_awb, providerBookingId: second.providerBookingId },
  );
});
