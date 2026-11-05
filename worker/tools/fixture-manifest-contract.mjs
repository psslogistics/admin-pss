import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../../../handover/internal/employee-qa/fixture-manifest.json", import.meta.url), "utf8"));
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const requiredTables = new Set((schema.match(/CREATE TABLE IF NOT EXISTS (\w+)/g) ?? []).map((row) => row.split(" ").at(-1)));
const supabaseTables = new Set(["client_accounts"]);
const required = manifest.required;

assert.equal(manifest.providerFacingWrites, false, "fixture manifest must prohibit provider-facing writes");
assert.equal(manifest.classification, "synthetic_employee_qa", "fixture classification must remain synthetic");
assert.equal(required.length, 15, "all plan fixtures must be represented");
assert.equal(new Set(required.map((fixture) => fixture.id)).size, required.length, "fixture IDs must be unique");
assert.equal(manifest.forbiddenOperations.length, 7, "all forbidden operation classes must remain listed");
for (const fixture of required) assert.ok(requiredTables.has(fixture.table) || supabaseTables.has(fixture.table), `${fixture.id} references a missing fixture table ${fixture.table}`);
for (const fixture of required.filter((item) => item.table === "shipments" || item.table === "pickup_requests")) assert.match(fixture.isTest, /is_test=1/);
for (const operation of ["provider booking", "pickup submission", "wallet adjustment", "invoice settlement", "financial reconciliation", "api-key rotation", "courier credential change"]) assert.ok(manifest.forbiddenOperations.includes(operation), `forbidden operation missing: ${operation}`);

console.log(`Fixture manifest contract passed (${required.length} fixtures, ${manifest.forbiddenOperations.length} forbidden operation classes).`);
