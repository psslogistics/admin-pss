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
