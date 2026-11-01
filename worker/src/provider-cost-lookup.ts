export type ProviderCostReference = {
  lrNumber: string;
};

export function resolveDelhiveryCostReference(input: {
  lrNumber?: unknown;
  trackingNumber?: unknown;
}): ProviderCostReference | null {
  const lrNumber = normalize(input.lrNumber);
  const trackingNumber = normalize(input.trackingNumber);
  // The B2B freight-breakup endpoint accepts LRNs. A master AWB or generic
  // provider reference is a different identifier and produces a provider 404.
  // Legacy records may store the LR in tracking_number, so keep that fallback.
  const lookup = lrNumber || trackingNumber;
  if (!/^\d{9}$/.test(lookup)) return null;
  return { lrNumber: lookup };
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
