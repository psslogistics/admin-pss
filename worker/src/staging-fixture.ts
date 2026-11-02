/**
 * Synthetic, non-identifying data for local/staging workflow tests only.
 * These values intentionally do not resemble real government identifiers.
 */
export const STAGING_TEST_CLIENT = {
  id: "staging-client-test-only",
  identity_environment: "test" as const,
  display_name: "PSS TEST ONLY",
  email: "test-only@example.invalid",
};

export const STAGING_TEST_SHIPMENT = {
  id: "staging-shipment-test-only",
  consignor: {
    name: "TEST CONSIGNOR ONLY",
    address: "1 Test Lane, Sandbox City",
    pincode: "000000",
  },
  consignee: {
    name: "TEST CONSIGNEE ONLY",
    address: "2 Test Road, Sandbox City",
    pincode: "000000",
  },
  weight_kg: 20,
  pieces: 1,
};

export function assertStagingFixture(value: unknown) {
  const serialized = JSON.stringify(value);
  if (!serialized.includes("TEST ONLY")) {
    throw new Error("Staging fixture lost its TEST ONLY marker");
  }
  if (/\b\d{12}\b|\b[A-Z]{5}\d{4}[A-Z]\b|\b\d{2}[A-Z0-9]{13}\b/.test(serialized)) {
    throw new Error("Staging fixture must not contain identity-like identifiers");
  }
}
