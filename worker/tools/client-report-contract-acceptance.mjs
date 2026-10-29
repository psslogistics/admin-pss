import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "worker", "src", "index.ts"), "utf8");

const checks = [
  ["complete report keeps shipment commercial fields", /shipments:\s*"[^"]*declared_value, pieces, dimensions_json, edd/],
  ["complete report keeps pickup contact fields", /pickup_requests:\s*"[^"]*contact_name, contact_phone, city, state, pincode, country/],
  ["complete report keeps pickup package fields", /pickup_requests:\s*"[^"]*pieces, total_weight_kg, assigned_to_user_id, status/],
  ["complete report keeps billing identity fields", /billing_records:\s*"[^"]*invoice_number, amount, currency, status, due_date/],
  ["complete report still scopes rows through related visibility", /const visibility = relatedShipmentVisibilityClause\(auth, table, sourceAlias\)/],
];

for (const [label, pattern] of checks) assert.match(source, pattern, label);
console.log(`Client report contract checks passed (${checks.length} checks).`);
