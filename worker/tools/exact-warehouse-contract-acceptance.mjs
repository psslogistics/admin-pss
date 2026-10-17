import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const required = [
  ["exact local warehouse lookup", "WHERE client_id = ? AND id = ? LIMIT 1"],
  ["client booking can resolve an unsaved pickup address", "ensureDelhiveryWarehouse"],
  ["pending activation is explicit", "WAREHOUSE_ACTIVATION_PENDING"],
  ["provider creation is idempotent", '"Idempotency-Key": warehouseCreateIdempotencyKey'],
  ["provider name is persisted", "provider_name"],
  ["provider error is persisted", "provider_error"],
  ["activation timestamp is persisted", "provider_activated_at"],
  ["cross-account warehouse reuse is blocked", "WAREHOUSE_ACCOUNT_MISMATCH"],
  ["pickup IDs resolve only to warehouses", "The selected pickup warehouse is not saved for this client"],
  ["saved warehouse account is validated and persisted", "PROVIDER_ACCOUNT_NOT_ALLOWED"],
  ["saved warehouse keeps the Delhivery account", "provider, provider_account_id, provider_status"],
  ["saved warehouse keeps the consignor name", "contact_name"],
  ["saved warehouse keeps the consignor state", "state"],
  ["pending creation preserves returned provider mapping", "provider_reference = COALESCE(?, provider_reference)"],
  ["confirmed booking evidence gates reuse", "delhiveryWarehouseHasConfirmedBooking"],
  ["registered provider locations are reused before an LR exists", "existingProviderLocation"],
  ["unsaved repeat bookings resolve an exact warehouse", "lower(trim(COALESCE(address, ''))) = lower(trim(?)"],
  ["confirmed provider reference is required", "provider_sync_status = 'confirmed' AND provider_reference IS NOT NULL"],
  ["replacement warehouse names are unique", " - PSS-${replacementId.slice(0, 8)}"],
  ["canonical provider warehouse identity", "canonicalDelhiveryWarehouseName"],
  ["provider uses the selected saved warehouse name exactly", "const providerName = localName;"],
  ["registration is used without facility lookup", "Facility lookup is intentionally reserved for pickup-slot operations."],
  ["registration retry remains scheduled", "provider_booking_payload_json"],
  ["activation retry is scheduled", "retryPendingDelhiveryBookings"],
  ["warehouse reads collapse duplicate identities", "normalizeWarehouseIdentityPart"],
  ["warehouse creation reuses an exact existing location", "deduplicated: true"],
];

for (const [label, needle] of required) {
  if (!source.includes(needle)) throw new Error(`Missing contract: ${label}`);
}

if (source.includes("activeFallback") || source.includes("Reuse that provider warehouse globally")) {
  throw new Error("Unsafe account-wide provider fallback remains");
}

if (source.includes("if (directId && directCode) return")) {
  throw new Error("Caller-supplied provider facility bypass remains");
}

if (source.includes('search_on: ["pincode"]') || source.includes("{ page: 1, page_size: 100 },")) {
  throw new Error("Pincode-only or account-wide provider lookup fallback remains");
}

console.log(`Exact warehouse contract passed (${required.length} checks)`);
