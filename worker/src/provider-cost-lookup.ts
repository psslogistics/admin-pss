export type ProviderCostReference = {
  lrNumber: string;
};

const delhiveryB2bHosts = [
  "https://btob.api.delhivery.com",
  "https://ltl-clients-api.delhivery.com",
] as const;

export function alternateDelhiveryB2bBase(configuredBase: string): string {
  const normalized = configuredBase.trim().replace(/\/$/, "");
  return normalized === delhiveryB2bHosts[0] ? delhiveryB2bHosts[1] : delhiveryB2bHosts[0];
}

export function delhiveryFreightBreakupUrl(base: string, lrNumber: string): string {
  return `${base.replace(/\/$/, "")}/lrn/freight-breakup/lrns=${encodeURIComponent(lrNumber)}`;
}

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
