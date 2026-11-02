type TestDoublePayload = Record<string, unknown>;
export type ProviderTestDoubleResult = {
  enabled: boolean;
  status: string;
  providerStatus?: string | number | null;
  providerPending?: boolean;
  providerBookingId?: string | null;
  providerReference?: string | null;
  providerSlotId?: string | null;
  acceptedDate?: string | null;
  acceptedWindow?: string | null;
  lr_number?: string | null;
  master_awb?: string | null;
  tracking_number?: string | null;
  normalized_status?: string;
  actual_weight_kg?: number;
  provider_weight_kg?: number;
  weight_kg?: number;
  provider_cost?: number;
  provider_amount?: number;
  currency?: string;
  serviceable?: boolean;
  pickup?: boolean;
  prepaid?: boolean;
  cod?: boolean;
  provenance?: string;
  pickupStatus?: string;
  providerStatusDetail?: string;
  code?: string;
  error?: string;
  reason?: string;
  error_code?: string;
  retryable?: boolean;
  message?: string;
  artifact?: unknown;
};

function stableDigits(value: string, length: number) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000_000;
  return String(hash).padStart(length, "0").slice(-length);
}

function testReference(prefix: string, seed: string, length: number) {
  return `${prefix}${stableDigits(seed, length - prefix.length)}`;
}

function dateOrTomorrow(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Deterministic provider responses for staging-only handover verification.
 * This module has no network access and must only be called after the Worker
 * has verified both the environment and the explicit test-client marker.
 */
export function providerTestDouble(operation: string, payload: TestDoublePayload): ProviderTestDoubleResult | null {
  const seed = String(payload.shipment_id ?? payload.pickup_id ?? payload.tracking_number ?? "handover-test");
  const lr = testReference("98", seed, 10);
  const awb = testReference("990", seed, 13);
  const bookingId = `test-job-${stableDigits(seed, 10)}`;
  const scenario = String(payload.test_scenario ?? "").trim().toLowerCase();

  if (scenario === "rejected" && (operation === "shipments" || operation === "pickups")) {
    return { enabled: true, status: "failed", providerStatus: 422, code: "TEST_PROVIDER_REJECTED", error: "Synthetic provider rejection", reason: "TEST ONLY: provider rejected the request", retryable: false, provenance: "staging_test_double" };
  }
  if (scenario === "timeout" && (operation === "shipments" || operation === "pickups")) {
    return { enabled: true, status: "timeout", providerStatus: null, code: "TEST_PROVIDER_TIMEOUT", error: "Synthetic provider timeout", reason: "TEST ONLY: provider did not respond within the timeout", retryable: true, provenance: "staging_test_double" };
  }
  if (scenario === "missing_reference" && operation === "shipments") {
    return { enabled: true, status: "accepted", providerStatus: 202, providerPending: true, providerBookingId: bookingId, providerReference: null, lr_number: null, master_awb: null, message: "TEST ONLY: accepted, provider reference pending", provenance: "staging_test_double" };
  }

  if (operation === "serviceability") {
    return { enabled: true, status: "accepted", providerStatus: 200, serviceable: true, pickup: true, prepaid: true, cod: true, provenance: "staging_test_double" };
  }
  if (operation === "serviceability_route") {
    return { enabled: true, status: "accepted", providerStatus: 200, serviceable: true, prepaid: true, cod: true, provenance: "staging_test_double" };
  }
  if (operation === "shipments" || operation === "shipment_status") {
    return { enabled: true, status: "accepted", providerStatus: 201, providerPending: false, providerBookingId: bookingId, providerReference: awb, lr_number: lr, master_awb: awb, tracking_number: awb, provenance: "staging_test_double" };
  }
  if (operation === "tracking") {
    return { enabled: true, status: "accepted", providerStatus: 200, providerBookingId: bookingId, providerReference: awb, lr_number: lr, master_awb: awb, tracking_number: awb, normalized_status: "in_transit", actual_weight_kg: 20, provider_weight_kg: 20, weight_kg: 20, provenance: "staging_test_double" };
  }
  if (operation === "pickups") {
    const pickupReference = `TEST-PICKUP-${stableDigits(seed, 8)}`;
    return { enabled: true, status: "accepted", providerStatus: 201, providerPending: false, providerReference: pickupReference, providerSlotId: `test-slot-${stableDigits(seed, 8)}`, acceptedDate: dateOrTomorrow(payload.scheduled_date ?? payload.requested_date), acceptedWindow: String(payload.window ?? payload.requested_time_slot ?? "09:00-12:00"), provenance: "staging_test_double" };
  }
  if (operation === "pickup_status") {
    return { enabled: true, status: "accepted", providerStatus: 200, pickupStatus: "scheduled", providerStatusDetail: "Staging provider test double", provenance: "staging_test_double" };
  }
  if (operation === "freight_charges") {
    return { enabled: true, status: "accepted", providerStatus: 200, provider_cost: 100, provider_amount: 100, currency: "INR", provenance: "staging_test_double" };
  }
  return null;
}
