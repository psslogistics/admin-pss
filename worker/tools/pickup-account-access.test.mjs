import test from "node:test";
import assert from "node:assert/strict";
import { canReadProviderAccountPoliciesForPickup, shapeProviderAccountsForPickup } from "../src/pickup-account-access.ts";

test("pickup creation permission is sufficient to look up provider account options", () => {
  assert.equal(canReadProviderAccountPoliciesForPickup({ canReadProviderAccounts: false, canQuote: false, canCreatePickup: true }), true);
  assert.equal(canReadProviderAccountPoliciesForPickup({ canReadProviderAccounts: false, canQuote: false, canCreatePickup: false }), false);
});

test("pickup-only lookup returns enabled accounts and omits policy and credential metadata", () => {
  const rows = [
    { id: "active", provider: "delhivery", account_name: "Primary", enabled: true, rate_card_id: "rate-secret", notes: "internal" },
    { id: "disabled", provider: "delhivery", account_name: "Disabled", enabled: false, rate_card_id: "old", notes: "disabled" },
  ];
  assert.deepEqual(shapeProviderAccountsForPickup(rows, true), [
    { id: "active", provider: "delhivery", account_name: "Primary", enabled: true },
  ]);
  assert.deepEqual(shapeProviderAccountsForPickup(rows, false), rows);
});
