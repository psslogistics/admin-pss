import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitKycTestOrganization, isKycTestModeEnabled } from "../src/kyc-test-identity.ts";

test("test KYC mode is fail-closed outside test and staging environments", () => {
  assert.equal(isKycTestModeEnabled("production", "true"), false);
  assert.equal(isKycTestModeEnabled("staging", "false"), false);
  assert.equal(isKycTestModeEnabled("test", "true"), true);
  assert.equal(isKycTestModeEnabled("staging", "true"), true);
});

test("only explicitly test-classified organizations receive the test KYC exemption", () => {
  assert.equal(isExplicitKycTestOrganization([{ id: "client-a", identity_environment: "test" }], ["client-a"]), true);
  assert.equal(isExplicitKycTestOrganization([{ id: "client-a", identity_environment: "production" }], ["client-a"]), false);
});

test("mixed, missing, or incomplete organization classifications fail closed", () => {
  assert.equal(isExplicitKycTestOrganization([{ id: "client-a", identity_environment: "test" }, { id: "client-b", identity_environment: "production" }], ["client-a", "client-b"]), false);
  assert.equal(isExplicitKycTestOrganization([{ id: "client-a", identity_environment: "test" }], ["client-a", "client-b"]), false);
  assert.equal(isExplicitKycTestOrganization([], []), false);
});
