export type ServiceabilityObservation = {
  status?: unknown;
  serviceable?: unknown;
  pickup?: unknown;
  prepaid?: unknown;
  cod?: unknown;
  providerStatus?: unknown;
  error?: unknown;
  reason?: unknown;
  oda?: unknown;
};

export type ServiceabilityDecision = {
  ok: boolean;
  reason?: string;
  providerUnavailable: boolean;
};

export function serviceabilityCacheKey(providerAccountId: string, originPincode: string, destinationPincode: string, paymentMode?: string) {
  const mode = String(paymentMode ?? "any").trim().toLowerCase() === "cod" ? "cod" : String(paymentMode ?? "any").trim().toLowerCase() === "prepaid" ? "prepaid" : "any";
  return `${providerAccountId}|${originPincode}|${destinationPincode}|${mode}`;
}

export function evaluateDelhiveryServiceability(origin: ServiceabilityObservation, destination: ServiceabilityObservation, paymentMode?: string): ServiceabilityDecision {
  const originAccepted = origin.status === "accepted" && origin.serviceable === true && origin.pickup === true;
  const destinationAccepted = destination.status === "accepted" && destination.serviceable === true;
  const providerUnavailable = [origin, destination].some((result) => result.status === "failed" || result.status === "provider_unavailable" || result.status === "not_configured" || Number(result.providerStatus ?? 0) === 0);
  if (origin.status !== "accepted") return { ok: false, providerUnavailable, reason: String(origin.error ?? origin.reason ?? "Delhivery could not verify the pickup pincode") };
  if (!originAccepted) return { ok: false, providerUnavailable, reason: "The pickup pincode is not pickup-serviceable by Delhivery" };
  if (destination.status !== "accepted") return { ok: false, providerUnavailable, reason: String(destination.error ?? destination.reason ?? "Delhivery could not verify the delivery pincode") };
  if (!destinationAccepted) return { ok: false, providerUnavailable, reason: "The delivery pincode is not serviceable by Delhivery" };
  const mode = String(paymentMode ?? "").trim().toLowerCase();
  if (mode === "cod" && destination.cod !== true) return { ok: false, providerUnavailable, reason: "The delivery pincode does not support COD with Delhivery" };
  if (mode === "prepaid" && destination.prepaid !== true) return { ok: false, providerUnavailable, reason: "The delivery pincode does not support prepaid delivery with Delhivery" };
  return { ok: true, providerUnavailable };
}
