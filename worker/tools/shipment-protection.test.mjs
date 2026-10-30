import test from "node:test";
import assert from "node:assert/strict";
import { providerManagedShipmentFields } from "../src/shipment-protection.ts";

test("protects provider identifiers, lifecycle, reconciled weight, ETA, and delivery time", () => {
  assert.deepEqual(providerManagedShipmentFields({ lr_number: "LR1", status: "delivered", edd: "2026-10-30" }), ["lr_number", "status", "edd"]);
  assert.deepEqual(providerManagedShipmentFields({ provider_reference: null, total_weight_kg: undefined }), ["provider_reference", "total_weight_kg"]);
});

test("does not block ordinary internal shipment edits", () => {
  assert.deepEqual(providerManagedShipmentFields({ description: "Fragile item", declared_value: 1000, pieces: 2 }), []);
});
