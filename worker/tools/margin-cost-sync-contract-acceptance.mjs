import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/20261030_margin_cost_sync_fairness.sql", import.meta.url), "utf8");
const marginRoute = source.match(/if \(route === "\/pricing\/internal\/margins"[\s\S]*?\n      if \(route === "\/serviceability"/)?.[0] ?? "";

assert.ok(marginRoute.includes("LIMIT 50"), "cost refresh remains bounded to 50 provider requests per action");
assert.ok(marginRoute.includes("GROUP BY b.shipment_id"), "duplicate billing rows do not duplicate provider lookups");
assert.ok(marginRoute.includes("margin-cost:' || b.shipment_id"), "attempt cooldown is tied to shipment identity");
assert.ok(marginRoute.includes("datetime('now', '-6 hours')"), "recent failed requests cool down instead of starving later rows");
assert.ok(marginRoute.includes("NULLIF(trim(s.lr_number), '')"), "only shipments with a provider lookup reference enter the queue");
assert.ok(marginRoute.includes("lower(COALESCE(b.status, '')) = 'paid'"), "provider cost sync ignores unpaid and void charges");
assert.ok(marginRoute.includes("b.status AS billing_status"), "margin rows expose the authoritative PSS billing status");
assert.ok(marginRoute.includes("lower(COALESCE(b.status, '')) <> 'paid'"), "non-paid billing records cannot produce provider amount or margin");
assert.ok(marginRoute.includes("`margin-cost:${shipmentId}`"), "provider attempts persist the shipment-scoped cooldown key");
assert.ok(migration.includes("idx_integration_requests_margin_cost_cooldown"), "cooldown lookup has a supporting index");
console.log("Margin cost sync contract checks passed (10 checks).");
