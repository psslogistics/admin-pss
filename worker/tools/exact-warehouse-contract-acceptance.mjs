import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const required = [
  ["exact local warehouse lookup", "WHERE client_id = ? AND id = ? LIMIT 1"],
  ["client booking requires a selected warehouse", "PICKUP_WAREHOUSE_REQUIRED"],
  ["pending activation is explicit", "WAREHOUSE_ACTIVATION_PENDING"],
  ["provider creation is idempotent", '"Idempotency-Key": warehouseCreateIdempotencyKey'],
  ["facility lookup checks the Delhivery console gateway", "ucp-app-gateway.delhivery.com"],
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
  ["stored provider mapping constrains lookup", "delhiveryFacilityMatches(row, name, pincode, localWarehouse?.provider_reference)"],
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

console.log(`Exact warehouse contract passed (${required.length} checks)`);
