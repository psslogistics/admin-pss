export type PricingAccount = "04" | "08" | "other";
export type PricingZone = "N1" | "N2" | "E" | "NE" | "W1" | "W2" | "S1" | "S2" | "Central";

export type ChargeRule = {
  code: string;
  label: string;
  kind: "fixed" | "percent" | "per_kg" | "minimum" | "maximum";
  value: number;
  basis?: "freight" | "freight_plus_docket" | "invoice_value" | "chargeable_weight" | "subtotal";
  minimum?: number;
  maximum?: number;
  enabled?: boolean;
  marker?: "*";
  displayOrder?: number;
  condition?: "oda_or_opa" | "rto";
};

export type PricingInput = {
  account: PricingAccount;
  originPincode?: string;
  destinationPincode?: string;
  originCity?: string;
  destinationCity?: string;
  originState?: string;
  destinationState?: string;
  actualWeightKg: number;
  volumetricWeightKg?: number;
  invoiceValue?: number;
  rto?: boolean;
  forwardRatePerKg?: number;
  forwardOriginZoneOverride?: string;
  forwardDestinationZoneOverride?: string;
  chargeRules: ChargeRule[];
  minimumWeightKg?: number;
  gstPercent?: number;
  versionId?: string;
  rateMatrix?: Record<string, number>;
  originZoneOverride?: string;
  destinationZoneOverride?: string;
  oda?: boolean;
  opa?: boolean;
};

export type PricingLine = { code: string; label: string; amount: number; marker?: "*" };
export type PricingResult = {
  versionId?: string;
  account: PricingAccount;
  originZone: string;
  destinationZone: string;
  lane: string;
  chargeableWeightKg: number;
  lines: PricingLine[];
  subtotal: number;
  gst: number;
  total: number;
};

const ZONES: PricingZone[] = ["N1", "N2", "E", "NE", "W1", "W2", "S1", "S2", "Central"];

const MATRIX_04: Record<PricingZone, number[]> = {
  N1: [7.7, 9, 16, 24.2, 12.1, 14.6, 18.2, 21.5, 12.7], N2: [9.8, 9.6, 19, 28.4, 13.9, 15.7, 20.6, 23.3, 15.5],
  E: [12.9, 15.4, 9.6, 17.8, 14.1, 14.5, 14.9, 19, 12.9], NE: [15, 21, 11.7, 9.8, 16.2, 19.8, 17.3, 22, 14.9],
  W1: [11.8, 15.8, 18.2, 28.6, 9, 10.5, 16.5, 18.7, 12.9], W2: [14.1, 17.2, 17.4, 27, 9, 9, 13.4, 18.7, 12.9],
  S1: [17.3, 19, 16.7, 28.5, 14.1, 10.9, 9, 10.5, 13.6], S2: [19.8, 23.8, 19, 29.7, 15.5, 15.5, 10.3, 9.4, 14.9],
  Central: [11.7, 12.9, 15.4, 28.1, 10.3, 10.9, 15.4, 19.8, 9.4],
};
const MATRIX_08: Record<PricingZone, number[]> = {
  N1: [4.4, 4.8, 8.5, 10.8, 6.3, 7.2, 8.9, 10.8, 6.3], N2: [4.8, 4.8, 9, 12.3, 7.4, 7.4, 9.8, 12.2, 7.4],
  E: [7.4, 8.1, 4.8, 7, 7.4, 7.4, 7.4, 10.4, 6.3], NE: [7.4, 8.1, 6.3, 4.8, 8.1, 8.1, 8.1, 11.1, 7.4],
  W1: [6.6, 7.4, 10.8, 13, 4.8, 4.8, 7.4, 10.4, 6.6], W2: [7, 7.8, 10.8, 13, 4.8, 4.4, 6.3, 9.3, 6.3],
  S1: [8.2, 9.3, 8.9, 11.5, 7.4, 5.9, 4.8, 6.8, 6.3], S2: [8.9, 8.9, 8.9, 11.5, 7.4, 7.4, 4.8, 4.8, 6.3],
  Central: [6.6, 7, 7.4, 9.3, 5.5, 5.9, 5.9, 8.9, 4.8],
};

// Namo B2B matrix. The published 16-zone card is intentionally separate from
// the 04/08 matrices; B2C is never consulted by this module.
const NAMO_ZONES = ["N1", "N2", "N3", "N4", "C1", "C2", "W1", "W2", "S1", "S2", "S3", "S4", "E1", "E2", "NE1", "NE2"] as const;
const NAMO_MATRIX: number[][] = [
  [5.8,7.54,7.8,10.4,10.66,10.4,10.53,10.79,15.2,13.8,19.1,18.96,13.78,14.7,19.7,23.79],
  [7.41,7.54,7.8,10.4,10.66,11.57,12.74,11.18,16.25,16.9,21.71,21.32,13,14.04,19.37,24.7],
  [7.93,7.8,7.93,8.45,10.66,11.31,11.57,12.74,18.46,18.85,16.9,19.11,13.39,14.56,20.28,26],
  [8.71,8.45,8.06,9.1,11.05,12.09,11.83,12.74,18.59,19.5,21.84,19.5,14.04,15.21,21.45,29.64],
  [10.53,11.31,11.7,14.3,6.5,7.41,9.1,9.49,11.31,13,13,15.6,12.74,13.65,16.38,18.2],
  [11.57,11.31,12.22,15.6,7.67,7.67,9.62,10.14,11.31,12.74,12.74,15.29,13.75,13.78,17.29,20.41],
  [10.79,11.57,11.7,15.6,9.49,10.27,6.5,7.28,11.57,14.014,14.014,16.562,12.74,18.85,18.33,23.4],
  [10.79,11.31,12.48,15.6,10.4,11.05,7.41,7.41,11.44,14.014,14.014,16.562,13.754,14.69,20.02,26],
  [10.79,11.7,11.96,15.6,9.88,10.4,9.49,10.27,6.63,7.267,7.774,8.151,12.363,13.39,18.33,26],
  [11.05,11.57,12.48,16.9,10.53,11.05,9.75,10.53,7.28,7.384,7.774,8.151,13.754,14.56,18.85,26],
  [11.7,11.96,12.35,18.2,10.4,11.05,10.92,11.57,8.06,8.021,7.384,8.788,13.637,14.95,19.89,27.3],
  [11.96,12.22,13,19.5,10.79,11.44,10.92,11.7,8.32,8.281,8.658,7.384,14.144,15.73,21.45,28.47],
  [10.4,13,11.96,12.61,10.4,11.44,10.14,11.31,11.31,13.377,15.288,15.288,6.37,7.67,13.13,14.82],
  [11.05,11.44,12.35,13.26,11.44,12.61,11.44,12.48,11.18,12.22,14.014,15.288,7.774,7.8,14.95,16.38],
  [18.33,19.24,20.28,22.1,17.29,17.42,18.2,20.15,19.24,19.877,19.877,21.151,13,14.56,10.53,12.35],
  [21.97,22.75,23.66,25.61,18.2,18.85,22.1,23.53,22.1,22.425,23.309,25.103,14.651,16.12,11.05,12.87],
];

const metroZones: Record<string, PricingZone> = {
  delhi: "N1", faridabad: "N1", gurgaon: "N1", gurugram: "N1", ghaziabad: "N1", noida: "N1", sahibabad: "N1", chandigarh: "N2", jaipur: "N1",
  bhopal: "Central", indore: "Central", raipur: "Central", kolkata: "E", patna: "E", ranchi: "E", bhubaneswar: "E", siliguri: "E", guwahati: "NE",
  bengaluru: "S1", bangalore: "S1", hyderabad: "S1", chennai: "S1", mumbai: "W1", pune: "W1", thane: "W1", ahmedabad: "W1", surat: "W1",
  dehradun: "N2", ludhiana: "N2",
};
const stateZones: Record<string, PricingZone> = {
  delhi: "N1", haryana: "N1", rajasthan: "N1", uttarpradesh: "N1", chandigarh: "N2", punjab: "N2", himachalpradesh: "N2", uttarakhand: "N2", jammuandkashmir: "N2", ladakh: "N2",
  westbengal: "E", odisha: "E", bihar: "E", jharkhand: "E", assam: "NE", meghalaya: "NE", tripura: "NE", arunachalpradesh: "NE", mizoram: "NE", manipur: "NE", nagaland: "NE", sikkim: "NE",
  gujarat: "W1", damandiu: "W1", dadraandnagarhaveli: "W1", maharashtra: "W2", goa: "W2", andhrapradesh: "S1", telangana: "S1", karnataka: "S1", tamilnadu: "S1", puducherry: "S1", kerala: "S2", madhyapradesh: "Central", chhattisgarh: "Central",
};
const namoMetroZones: Record<string, typeof NAMO_ZONES[number]> = {
  bhopal: "C1", indore: "C1", raipur: "C1", kolkata: "E1", patna: "E1", ranchi: "E1", bhubaneswar: "E1", siliguri: "E1", guwahati: "NE1",
  delhi: "N1", faridabad: "N1", gurgaon: "N1", gurugram: "N1", ghaziabad: "N1", noida: "N1", sahibabad: "N1", chandigarh: "N2", jaipur: "N1",
  bengaluru: "S1", bangalore: "S1", hyderabad: "S1", chennai: "S1", mumbai: "W1", pune: "W1", thane: "W1", ahmedabad: "W1", surat: "W1", dehradun: "N2", ludhiana: "N2",
};
const namoStateZones: Record<string, typeof NAMO_ZONES[number]> = {
  delhi: "N1", haryana: "N3", rajasthan: "N3", uttarpradesh: "N3", chandigarh: "N2", punjab: "N3", himachalpradesh: "N4", uttarakhand: "N4", jammuandkashmir: "N4", ladakh: "N4",
  westbengal: "E2", odisha: "E2", bihar: "E2", jharkhand: "E2", assam: "NE2", meghalaya: "NE2", tripura: "NE2", arunachalpradesh: "NE2", mizoram: "NE2", manipur: "NE2", nagaland: "NE2", sikkim: "NE2",
  gujarat: "W2", damandiu: "W2", dadraandnagarhaveli: "W2", maharashtra: "W2", goa: "W2", andhrapradesh: "S2", telangana: "S2", karnataka: "S2", tamilnadu: "S3", puducherry: "S3", kerala: "S4", madhyapradesh: "C2", chhattisgarh: "C2",
};
const clean = (value: string | undefined) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

export function resolveZone(city?: string, state?: string): PricingZone {
  const cityKey = clean(city);
  if (metroZones[cityKey]) return metroZones[cityKey];
  const stateKey = clean(state);
  if (stateZones[stateKey]) return stateZones[stateKey];
  throw new Error("ZONE_NOT_CONFIGURED");
}
function resolveNamoZone(city?: string, state?: string): typeof NAMO_ZONES[number] {
  const cityKey = clean(city);
  if (namoMetroZones[cityKey]) return namoMetroZones[cityKey];
  const stateKey = clean(state);
  if (namoStateZones[stateKey]) return namoStateZones[stateKey];
  throw new Error("ZONE_NOT_CONFIGURED");
}

function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function rateFor(account: PricingAccount, origin: string, destination: string) {
  if (account === "other") {
    const row = NAMO_ZONES.indexOf(origin as typeof NAMO_ZONES[number]); const column = NAMO_ZONES.indexOf(destination as typeof NAMO_ZONES[number]);
    if (row >= 0 && column >= 0) return NAMO_MATRIX[row][column];
    throw new Error("NAMO_ZONE_NOT_CONFIGURED");
  }
  const matrix = account === "04" ? MATRIX_04 : MATRIX_08;
  const typedOrigin = origin as PricingZone; const typedDestination = destination as PricingZone;
  return matrix[typedOrigin][ZONES.indexOf(typedDestination)];
}

export function calculatePssRate(input: PricingInput): PricingResult {
  const originZone = input.originZoneOverride ?? (input.account === "other" ? resolveNamoZone(input.originCity, input.originState) : resolveZone(input.originCity, input.originState));
  const destinationZone = input.destinationZoneOverride ?? (input.account === "other" ? resolveNamoZone(input.destinationCity, input.destinationState) : resolveZone(input.destinationCity, input.destinationState));
  const laneOrigin = input.rto ? input.forwardOriginZoneOverride ?? originZone : originZone;
  const laneDestination = input.rto ? input.forwardDestinationZoneOverride ?? destinationZone : destinationZone;
  const chargeableWeightKg = Math.max(input.actualWeightKg, input.volumetricWeightKg ?? 0, input.minimumWeightKg ?? 20);
  const rate = input.rto && input.forwardRatePerKg !== undefined ? input.forwardRatePerKg : input.rateMatrix?.[`${laneOrigin}->${laneDestination}`] ?? rateFor(input.account, laneOrigin, laneDestination);
  const lines: PricingLine[] = [{ code: "freight", label: "Freight", amount: roundMoney(chargeableWeightKg * rate) }];
  const context: Record<string, number> = { freight: lines[0].amount, freight_plus_docket: lines[0].amount, invoice_value: input.invoiceValue ?? 0, chargeable_weight: chargeableWeightKg, subtotal: lines[0].amount };
  for (const rule of input.chargeRules.filter((item) => item.enabled !== false).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.code.localeCompare(b.code))) {
    if (rule.code === "gst") continue;
    if (rule.condition === "oda_or_opa" && !input.oda && !input.opa) continue;
    if (rule.condition === "rto" && !input.rto) continue;
    const basis = context[rule.basis ?? "freight"] ?? 0;
    let amount = rule.kind === "percent" ? basis * rule.value / 100 : rule.kind === "per_kg" ? chargeableWeightKg * rule.value : rule.kind === "minimum" ? Math.max(basis, rule.value) - basis : rule.kind === "maximum" ? Math.min(basis, rule.value) : rule.value;
    if (rule.minimum !== undefined) amount = Math.max(amount, rule.minimum);
    if (rule.maximum !== undefined) amount = Math.min(amount, rule.maximum);
    amount = roundMoney(amount);
    if (rule.kind === "minimum") { if (amount <= 0) continue; }
    lines.push({ code: rule.code, label: rule.label, amount, ...(rule.marker ? { marker: rule.marker } : {}) });
    context["subtotal"] = roundMoney(context.subtotal + amount);
    if (rule.code === "docket") context.freight_plus_docket = roundMoney(context.freight + amount);
  }
  const subtotal = roundMoney(context.subtotal);
  const gstPercent = input.gstPercent ?? 18;
  const gst = roundMoney(subtotal * gstPercent / 100);
  lines.push({ code: "gst", label: `GST ${gstPercent}%`, amount: gst });
  return { versionId: input.versionId, account: input.account, originZone, destinationZone, lane: `${originZone}->${destinationZone}`, chargeableWeightKg, lines, subtotal, gst, total: roundMoney(subtotal + gst) };
}

export function defaultRateRows(account: PricingAccount): Array<{ origin_zone: string; destination_zone: string; rate_per_kg: number }> {
  if (account === "other") return NAMO_ZONES.flatMap((origin, row) => NAMO_ZONES.map((destination, column) => ({ origin_zone: origin, destination_zone: destination, rate_per_kg: NAMO_MATRIX[row][column] })));
  const matrix = account === "04" ? MATRIX_04 : MATRIX_08;
  return ZONES.flatMap((origin) => ZONES.map((destination, column) => ({ origin_zone: origin, destination_zone: destination, rate_per_kg: matrix[origin][column] })));
}

