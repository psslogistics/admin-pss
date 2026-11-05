import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const trackingProjection = source.match(/const trackingShipmentColumns =([\s\S]*?);\r?\n\s*const selectedShipmentColumns/)?.[1] ?? "";
const detailProjection = source.match(/const sensitiveShipmentView =[^;]+/)?.[0] ?? "";
const shipmentProjectionBlock = source.match(/const shipmentColumns =([\s\S]*?)\/\/ Tracking is a high-frequency client read/)?.[1] ?? "";

assert.ok(trackingProjection, "tracking shipment projection is present");
assert.ok(detailProjection, "shipment detail authorization gate is present");
assert.ok(shipmentProjectionBlock, "shipment projection block is present");

for (const field of ["provider_amount", "provider_cost", "margin", "billing_amount", "provider_account_id"]) {
  assert.equal(trackingProjection.includes(field), false, `tracking projection must exclude ${field}`);
}

assert.match(detailProjection, /sensitiveShipmentView = auth\.system \|\| hasScope\(auth, "shipments\.sensitive\.read"\)/);
assert.match(shipmentProjectionBlock, /provider_account_id/);
assert.match(shipmentProjectionBlock, /provider_confirmation_status/);

console.log("Employee shipment field-exclusion contract checks passed (10 checks).");
