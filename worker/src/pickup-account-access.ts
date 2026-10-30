export function canReadProviderAccountPoliciesForPickup(input: {
  canReadProviderAccounts: boolean;
  canQuote: boolean;
  canCreatePickup: boolean;
}) {
  return input.canReadProviderAccounts || input.canQuote || input.canCreatePickup;
}

export function shapeProviderAccountsForPickup<T extends Record<string, unknown>>(rows: T[], pickupOnly: boolean) {
  if (!pickupOnly) return rows;
  return rows
    .filter((row) => row.enabled === true)
    .map((row) => ({
      id: String(row.id ?? ""),
      provider: String(row.provider ?? ""),
      account_name: String(row.account_name ?? ""),
      enabled: true,
    }));
}
