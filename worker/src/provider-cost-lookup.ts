export type ProviderCostReference = {
  trackingNumber: string;
  lrNumber?: string;
};

export function resolveDelhiveryCostReference(input: {
  lrNumber?: unknown;
  masterAwb?: unknown;
  trackingNumber?: unknown;
}): ProviderCostReference | null {
  const lrNumber = normalize(input.lrNumber);
  const masterAwb = normalize(input.masterAwb);
  const trackingNumber = normalize(input.trackingNumber);
  const lookup = lrNumber || masterAwb || trackingNumber;
  if (!lookup) return null;
  return { trackingNumber: lookup, ...(lrNumber ? { lrNumber } : {}) };
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
