import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

test("preflight is gated by the client-selected warehouse identity", () => {
  const preflight = source.slice(source.indexOf('route === \"/shipments/preflight\"'), source.indexOf('route === \"/shipments\" && request.method === \"POST\"'));
  assert.match(preflight, /warehouse_id/);
  assert.match(preflight, /PROVIDER_WAREHOUSE_REQUIRED/);
  assert.match(preflight, /PROVIDER_WAREHOUSE_NOT_FOUND/);
  assert.match(preflight, /PROVIDER_WAREHOUSE_MISMATCH/);
  assert.match(preflight, /PROVIDER_ACCOUNT_MISMATCH/);
  assert.match(preflight, /selectedWarehouse\.provider_name/);
  assert.doesNotMatch(preflight, /DELHIVERY_DEFAULT_PICKUP_LOCATION/);
});

test("B2B manifestation cannot use the retired environment default", () => {
  const manifest = source.slice(source.indexOf("function delhiveryB2bManifestPayload"), source.indexOf("function delhiveryCreatePayload"));
  assert.doesNotMatch(manifest, /DELHIVERY_DEFAULT_PICKUP_LOCATION/);
  assert.match(manifest, /payload\.delhivery_pickup_location/);
});
