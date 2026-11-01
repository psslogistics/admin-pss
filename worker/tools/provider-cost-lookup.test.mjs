import test from "node:test";
import assert from "node:assert/strict";
import { alternateDelhiveryB2bBase, delhiveryFreightBreakupUrl, resolveDelhiveryCostReference } from "../src/provider-cost-lookup.ts";

test("uses the LR for provider-cost lookup when available", () => {
  assert.deepEqual(resolveDelhiveryCostReference({ lrNumber: " 321955542 " }), {
    lrNumber: "321955542",
  });
});

test("uses the legacy tracking field when it contains the LR", () => {
  assert.deepEqual(resolveDelhiveryCostReference({ trackingNumber: " 321955542 " }), {
    lrNumber: "321955542",
  });
});

test("never treats a master AWB as an LR for freight breakup", () => {
  assert.equal(resolveDelhiveryCostReference({ masterAwb: "22038714769693" }), null);
});

test("rejects an AWB accidentally copied into the legacy tracking field", () => {
  assert.equal(resolveDelhiveryCostReference({ trackingNumber: "22038714769693" }), null);
});

test("rejects malformed explicit LR values rather than querying Delhivery with them", () => {
  assert.equal(resolveDelhiveryCostReference({ lrNumber: "22038714769693" }), null);
});

test("returns no lookup reference when all provider identifiers are blank", () => {
  assert.equal(resolveDelhiveryCostReference({ lrNumber: "  ", trackingNumber: undefined }), null);
});

test("selects the other supported Delhivery B2B host for read-only 404 fallback", () => {
  assert.equal(alternateDelhiveryB2bBase("https://ltl-clients-api.delhivery.com/"), "https://btob.api.delhivery.com");
  assert.equal(alternateDelhiveryB2bBase("https://btob.api.delhivery.com"), "https://ltl-clients-api.delhivery.com");
});

test("builds the freight-breakup request using the LR path format", () => {
  assert.equal(delhiveryFreightBreakupUrl("https://btob.api.delhivery.com/", "321955542"), "https://btob.api.delhivery.com/lrn/freight-breakup/lrns=321955542");
});
