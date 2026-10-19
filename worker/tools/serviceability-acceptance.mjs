import assert from "node:assert/strict";
import { evaluateDelhiveryServiceability, serviceabilityCacheKey } from "../src/serviceability.ts";

const accepted = (overrides = {}) => ({ status: "accepted", providerStatus: 200, serviceable: true, pickup: true, prepaid: true, cod: true, ...overrides });

assert.equal(evaluateDelhiveryServiceability(accepted(), accepted(), "prepaid").ok, true, "live prepaid route should pass");
assert.equal(evaluateDelhiveryServiceability(accepted(), accepted({ serviceable: false }), "prepaid").ok, false, "provider-negative destination must fail");
assert.match(evaluateDelhiveryServiceability(accepted({ pickup: false }), accepted(), "prepaid").reason, /pickup-serviceable/);
const oda = evaluateDelhiveryServiceability(accepted({ oda: true }), accepted({ oda: true }), "prepaid");
assert.equal(oda.ok, true, "ODA must remain a pricing surcharge signal, not a serviceability rejection");
assert.match(evaluateDelhiveryServiceability(accepted(), accepted({ cod: false }), "cod").reason, /does not support COD/);
const timeout = evaluateDelhiveryServiceability({ status: "failed", providerStatus: 0, error: "timeout" }, accepted(), "prepaid");
assert.equal(timeout.providerUnavailable, true, "provider timeout must be unavailable, not dataset-positive");
assert.notEqual(serviceabilityCacheKey("account-a", "110001", "201301", "cod"), serviceabilityCacheKey("account-a", "110001", "201301", "prepaid"), "payment mode must partition the cache");
assert.notEqual(serviceabilityCacheKey("account-a", "110001", "201301", "prepaid"), serviceabilityCacheKey("account-b", "110001", "201301", "prepaid"), "provider account must partition the cache");
assert.notEqual(serviceabilityCacheKey("account-a", "110001", "201301", "prepaid", 15), serviceabilityCacheKey("account-a", "110001", "201301", "prepaid", 25), "shipment weight must partition the cache");
console.log("Delhivery serviceability acceptance scenarios passed.");
