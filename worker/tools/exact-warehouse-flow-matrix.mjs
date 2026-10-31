import assert from "node:assert/strict";
import { canonicalDelhiveryWarehouseName, delhiveryFacilityMatches, isVerifiedDelhiveryWarehouse, normalizeDelhiveryWarehouseIdentity } from "../src/warehouse-identity.ts";

const active = { id: "provider-1", name: "Warehouse Alpha", pincode: "201310", status: "ACTIVE" };
const verifiedLocal = { provider: "delhivery", provider_account_id: "account-1", provider_status: "active", provider_reference: "facility-1", provider_activated_at: "2026-10-31T10:00:00Z" };

assert.equal(normalizeDelhiveryWarehouseIdentity("Warehouse-Alpha · 201310"), "warehousealpha201310");
assert.equal(delhiveryFacilityMatches(active, "warehouse alpha", "201310"), true, "exact active warehouse should match");
assert.equal(delhiveryFacilityMatches({ ...active, status: "INACTIVE" }, "Warehouse Alpha", "201310"), false, "inactive warehouse must not match");
assert.equal(delhiveryFacilityMatches({ ...active, pincode: "271801" }, "Warehouse Alpha", "201310"), false, "wrong pincode must not match");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Beta" }, "Warehouse Alpha", "201310"), false, "different local warehouse name must not match");
assert.equal(delhiveryFacilityMatches(active, "Warehouse Alpha", "201310", "provider-1"), true, "stored provider mapping should match");
assert.equal(delhiveryFacilityMatches(active, "Warehouse Alpha", "201310", "provider-2"), false, "different provider mapping must not match");
assert.notEqual("client-a|account-a|warehouse-1", "client-b|account-a|warehouse-1", "same address across clients must have distinct identity keys");
assert.notEqual("client-a|account-a|warehouse-1", "client-a|account-a|warehouse-2", "same address across local warehouses must have distinct identity keys");
assert.notEqual("client-a|account-a|warehouse-1", "client-a|account-b|warehouse-1", "same name under another account must have distinct identity keys");
assert.equal(delhiveryFacilityMatches({ ...active, enabled: false }, "Warehouse Alpha", "201310"), false, "provider-deactivated warehouse must block booking");
assert.equal(canonicalDelhiveryWarehouseName("Warehouse Alpha", "Lucknow", "Uttar Pradesh", "226017"), "Warehouse Alpha Lucknow Uttar Pradesh 226017", "provider name must include the complete selected location identity");
assert.equal(canonicalDelhiveryWarehouseName("Warehouse Alpha · Lucknow · Uttar Pradesh · 226017", "Lucknow", "Uttar Pradesh", "226017"), "Warehouse Alpha Lucknow Uttar Pradesh 226017", "provider name must not duplicate a saved-label suffix");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Alpha Lucknow Uttar Pradesh 226017" }, "Warehouse Alpha Lucknow Uttar Pradesh 226017", "201310"), true, "canonical active warehouse should match exactly");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Alpha Lucknow Uttar Pradesh 226017" }, "Warehouse Alpha Lucknow Uttar Pradesh 271801", "201310"), false, "same base name at a different selected location must not match");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Alpha" }, "Warehouse Alpha Lucknow Uttar Pradesh 226017", "201310", null, "Warehouse Alpha"), true, "provider base name should match the selected local warehouse");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Beta" }, "Warehouse Alpha Lucknow Uttar Pradesh 226017", "201310", null, "Warehouse Alpha"), false, "different provider base name must not match the selected local warehouse");
assert.equal(delhiveryFacilityMatches({ ...active, name: "Warehouse Alpha" }, "Warehouse Alpha Lucknow Uttar Pradesh 226017", "201310", "stale-provider-id", "Warehouse Alpha", true), true, "active local identity should recover from a stale provider reference");
assert.equal(isVerifiedDelhiveryWarehouse(verifiedLocal, "account-1"), true, "a provider-verified local facility is reusable before any LR exists");
assert.equal(isVerifiedDelhiveryWarehouse(verifiedLocal, "account-2"), false, "a verified facility cannot cross Delhivery accounts");
assert.equal(isVerifiedDelhiveryWarehouse({ ...verifiedLocal, provider_status: "pending" }, "account-1"), false, "pending provider registration cannot be reused");
assert.equal(isVerifiedDelhiveryWarehouse({ ...verifiedLocal, provider_reference: null }, "account-1"), false, "a local active flag without provider reference cannot be reused");
assert.equal(isVerifiedDelhiveryWarehouse({ ...verifiedLocal, provider_activated_at: null }, "account-1"), false, "a facility without verification timestamp cannot be reused");

console.log("Exact warehouse flow matrix passed (17 cases)");
