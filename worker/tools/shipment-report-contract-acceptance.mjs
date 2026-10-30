import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "worker", "src", "index.ts"), "utf8");
const route = source.match(/if \(route === "\/reports\/shipments"[\s\S]*?\/\/ Serve the client report/);
assert.ok(route, "shipment report route exists");

const checks = [
  ["report requires explicit report-read permission", /hasScope\(auth, "reports\.read"\)/],
  ["projection includes shipment/client/provider references", /SELECT id, client_id, pss_reference, lr_number, master_awb, provider_reference, tracking_number, provider/],
  ["projection includes route, status, package, declared value, dates, and delay", /origin, destination, status, total_weight_kg, pieces, declared_value, created_at, edd, delivered_at,[\s\S]*?AS delay_days/],
  ["report applies classified test-data visibility", /const reportShipmentVisibility = testDataVisibilityClause\(auth\)/],
  ["system admins receive organization-wide summary and detail rows", /auth\.system[\s\S]*?summarySql[\s\S]*?GROUP BY status[\s\S]*?auth\.system[\s\S]*?detailSql[\s\S]*?ORDER BY created_at DESC/],
  ["non-system users are constrained to authorized client IDs", /client_id IN \(\$\{\[\.\.\.auth\.clientIds\]\.map\(\(\) => "\?"\)\.join\(","\)\}\)/],
  ["response includes complete detail collection", /details: details\.results/],
];

for (const [label, pattern] of checks) assert.match(route[0], pattern, label);
console.log(`Shipment report contract checks passed (${checks.length} checks).`);
