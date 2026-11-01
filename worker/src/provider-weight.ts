export type ProviderWeightSnapshot = { measuredKg: number | null; chargeableKg: number | null };

const minimumShipmentWeightKg = 20;

export function effectiveShipmentWeightKg(declaredKg: number, providerKg: number | null) {
  const declared = Number.isFinite(declaredKg) && declaredKg > 0 ? declaredKg : 0;
  const provider = providerKg !== null && Number.isFinite(providerKg) && providerKg > 0 ? providerKg : 0;
  return Number(Math.max(minimumShipmentWeightKg, declared, provider).toFixed(3));
}

const providerWeightKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const providerWeightNumber = (value: unknown, key = "", unit?: unknown): number | null => {
  let raw: unknown = value;
  let explicitUnit = typeof unit === "string" ? unit.toLowerCase() : "";
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const object = raw as Record<string, unknown>;
    raw = object.value ?? object.amount ?? object.weight ?? object.value_kg ?? object.kg ?? object.grams ?? object.g;
    explicitUnit = String(object.unit ?? object.uom ?? explicitUnit).toLowerCase();
  }
  const number = Number(typeof raw === "string" ? raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0] : raw);
  if (!Number.isFinite(number) || number <= 0) return null;
  const normalizedKey = providerWeightKey(key);
  const grams = /gram|grams|gramme|gm|gms/.test(explicitUnit) || /gram|grams|gramme|gm|gms/.test(normalizedKey) || (normalizedKey.endsWith("g") && !normalizedKey.endsWith("kg"));
  const kg = /kg|kilogram/.test(explicitUnit) || /kg|kilogram/.test(normalizedKey);
  const normalized = grams ? number / 1000 : kg ? number : number > 1000 ? number / 1000 : number;
  return normalized > 0 && normalized < 100000 ? Number(normalized.toFixed(3)) : null;
};

export function findProviderWeight(value: unknown, depth = 0): ProviderWeightSnapshot {
  if (depth > 10 || value === null || value === undefined) return { measuredKg: null, chargeableKg: null };
  const measuredKeys = new Set(["actualweight", "actualweightkg", "capturedweight", "capturedweightkg", "measuredweight", "measuredweightkg", "shipmentweight", "shipmentweightkg", "weightcaptured", "weightcapturedkg"]);
  const chargeableKeys = new Set(["chargeableweight", "chargeableweightkg", "billableweight", "billableweightkg", "courierbilledweight", "courierbilledweightkg", "chargedweight", "chargedweightkg"]);
  let measuredKg: number | null = null;
  let chargeableKg: number | null = null;
  const walk = (node: unknown, level: number) => {
    if (level > 10 || node === null || node === undefined || (measuredKg !== null && chargeableKg !== null)) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, level + 1); return; }
    if (typeof node !== "object") return;
    const object = node as Record<string, unknown>;
    for (const [key, candidate] of Object.entries(object)) {
      const normalized = providerWeightKey(key);
      if (chargeableKg === null && (chargeableKeys.has(normalized) || /chargeable.*weight|billable.*weight|courier.*billed.*weight|charged.*weight/.test(normalized))) chargeableKg = providerWeightNumber(candidate, key);
      if (measuredKg === null && (measuredKeys.has(normalized) || /actual.*weight|captured.*weight|measured.*weight|shipment.*weight/.test(normalized))) measuredKg = providerWeightNumber(candidate, key);
      // Some Delhivery details expose only `Weight`; treat it as measured, never
      // as the courier-billed weight when an explicit billable field is absent.
      if (measuredKg === null && normalized === "weight") measuredKg = providerWeightNumber(candidate, key);
      if (candidate && typeof candidate === "object") walk(candidate, level + 1);
    }
  };
  walk(value, depth);
  return { measuredKg, chargeableKg };
}
