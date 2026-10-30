import test from "node:test";
import assert from "node:assert/strict";
import { resolveDelhiveryCostReference } from "../src/provider-cost-lookup.ts";

test("uses the LR for provider-cost lookup when available", () => {
  assert.deepEqual(resolveDelhiveryCostReference({ lrNumber: " 32195542 ", masterAwb: "22038714769693" }), {
    trackingNumber: "32195542",
    lrNumber: "32195542",
  });
});

test("falls back to master AWB or tracking number without mislabeling it as an LR", () => {
  assert.deepEqual(resolveDelhiveryCostReference({ masterAwb: "22038714769693", trackingNumber: "fallback" }), {
    trackingNumber: "22038714769693",
  });
  assert.deepEqual(resolveDelhiveryCostReference({ trackingNumber: " 22038714769693 " }), {
    trackingNumber: "22038714769693",
  });
});

test("returns no lookup reference when all provider identifiers are blank", () => {
  assert.equal(resolveDelhiveryCostReference({ lrNumber: "  ", masterAwb: null, trackingNumber: undefined }), null);
});
