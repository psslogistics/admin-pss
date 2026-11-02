import test from "node:test";
import assert from "node:assert/strict";
import { effectiveShipmentWeightKg, findProviderWeight } from "../src/provider-weight.ts";

test("reads nested measured and charged weight fields and converts grams", () => {
  assert.deepEqual(findProviderWeight({ data: [{ actual_weight: { value: "18.5", unit: "kg" }, charged_weight: "22000 g" }] }), {
    measuredKg: 18.5,
    chargeableKg: 22,
  });
});

test("reads Delhivery-style dead and billed weight aliases", () => {
  assert.deepEqual(findProviderWeight({ data: [{ dead_weight: "24 kg", billed_weight: { value: 26500, unit: "g" } }] }), {
    measuredKg: 24,
    chargeableKg: 26.5,
  });
});

test("keeps client weight above provider weight and enforces the 20 kg minimum", () => {
  assert.equal(effectiveShipmentWeightKg(24, 22), 24);
  assert.equal(effectiveShipmentWeightKg(12, 18), 20);
  assert.equal(effectiveShipmentWeightKg(12, 23.4567), 23.457);
});

test("does not invent a weight from absent or invalid provider fields", () => {
  assert.deepEqual(findProviderWeight({ data: [{ freight: 420 }] }), { measuredKg: null, chargeableKg: null });
  assert.deepEqual(findProviderWeight({ charged_weight: 0 }), { measuredKg: null, chargeableKg: null });
});
