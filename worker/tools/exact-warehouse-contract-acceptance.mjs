import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const required = [
  ["exact local warehouse lookup", "WHERE client_id = ? AND id = ? LIMIT 1"],
  ["client booking requires a selected warehouse", "PICKUP_WAREHOUSE_REQUIRED"],
  ["pending activation is explicit", "WAREHOUSE_ACTIVATION_PENDING"],
  ["provider creation is idempotent", '"Idempotency-Key": warehouseCreateIdempotencyKey'],
  ["provider name is persisted", "provider_name"],
  ["provider error is persisted", "provider_error"],
  ["activation timestamp is persisted", "provider_activated_at"],
];

for (const [label, needle] of required) {
  if (!source.includes(needle)) throw new Error(`Missing contract: ${label}`);
}

if (source.includes("activeFallback") || source.includes("Reuse that provider warehouse globally")) {
  throw new Error("Unsafe account-wide provider fallback remains");
}

console.log(`Exact warehouse contract passed (${required.length} checks)`);
