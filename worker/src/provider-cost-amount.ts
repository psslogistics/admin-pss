export function providerAmountForBookingResult(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (String(result.status ?? "").trim().toLowerCase() !== "accepted") return null;
  for (const key of ["amount", "shipping_charge", "freight", "total_amount", "billing_amount"]) {
    if (typeof result[key] === "string" && !result[key].trim()) continue;
    const amount = Number(result[key]);
    if (result[key] !== null && result[key] !== undefined && result[key] !== "" && Number.isFinite(amount) && amount >= 0) return amount;
  }
  return null;
}
