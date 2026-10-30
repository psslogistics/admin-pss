import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "worker", "src", "index.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "worker", "migrations", "20261030_provider_data_corrections.sql"), "utf8");
const start = source.indexOf("const providerCorrection = route.match");
const end = source.indexOf('if (shipmentUpdate && request.method === "PATCH")', start);
assert.ok(start >= 0 && end > start, "provider correction route is present before generic shipment PATCH");
const route = source.slice(start, end);

test("provider corrections require both Super Admin role and dedicated scope", () => {
  assert.match(route, /hasRole\(auth, \["super_admin"\]\)\s*\|\|\s*!hasScope\(auth, "provider_data\.correct"\)/);
});

test("corrections are attributed, idempotent, and audited", () => {
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /INSERT INTO shipment_provider_corrections/);
  assert.match(route, /shipment\.provider_data_correction_recorded/);
  assert.match(route, /actor_user_id/);
});

test("recording a correction does not update the shipment row", () => {
  assert.doesNotMatch(route, /UPDATE\s+shipments\s+SET/i);
  assert.match(route, /provider_value, correction_value, reason/);
});

test("correction schema constrains fields and stores evidence separately", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS shipment_provider_corrections/);
  assert.match(migration, /CHECK \(field IN/);
  assert.match(migration, /provider_value TEXT NOT NULL/);
  assert.match(migration, /correction_value TEXT NOT NULL/);
  assert.match(migration, /reason TEXT NOT NULL/);
  assert.match(migration, /actor_user_id TEXT NOT NULL/);
});
