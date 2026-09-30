import assert from "node:assert/strict";
import { calculatePssRate } from "../src/pricing-engine.ts";

const base = {
  actualWeightKg: 10,
  invoiceValue: 1000,
  chargeRules: [],
  gstPercent: 0,
};

const account04 = calculatePssRate({
  ...base,
  account: "04",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
});
assert.equal(account04.originZone, "N1");
assert.equal(account04.destinationZone, "S1");
assert.equal(account04.chargeableWeightKg, 20);
assert.equal(account04.lines[0].amount, 364);

const account08 = calculatePssRate({
  ...base,
  account: "08",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
});
assert.equal(account08.lines[0].amount, 178);
assert.notEqual(account04.lines[0].amount, account08.lines[0].amount);

const namoOther = calculatePssRate({
  ...base,
  account: "other",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
});
assert.equal(namoOther.originZone, "N1");
assert.equal(namoOther.destinationZone, "S1");
assert.equal(namoOther.lines[0].amount, 304);

const nonMetroState = calculatePssRate({
  ...base,
  account: "04",
  originCity: "Mysuru",
  originState: "Karnataka",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
});
assert.equal(nonMetroState.originZone, "S1");
assert.equal(nonMetroState.destinationZone, "S1");

const volumetric = calculatePssRate({
  ...base,
  account: "04",
  actualWeightKg: 25,
  volumetricWeightKg: 50,
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
});
assert.equal(volumetric.chargeableWeightKg, 50);
assert.equal(volumetric.lines[0].amount, 910);

const rto = calculatePssRate({
  ...base,
  account: "04",
  actualWeightKg: 10,
  rto: true,
  forwardOriginZoneOverride: "N1",
  forwardDestinationZoneOverride: "S1",
  forwardRatePerKg: 18.2,
  originCity: "Bengaluru",
  originState: "Karnataka",
  destinationCity: "Delhi",
  destinationState: "Delhi",
});
assert.equal(rto.lines[0].amount, 364);

const extras = calculatePssRate({
  ...base,
  account: "04",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
  oda: true,
  chargeRules: [
    { code: "docket", label: "LR charge", kind: "fixed", value: 50, displayOrder: 1 },
    { code: "fov", label: "FOV", kind: "percent", basis: "invoice_value", value: 5, minimum: 80, displayOrder: 2 },
    { code: "oda", label: "ODA*", kind: "fixed", value: 100, condition: "oda_or_opa", marker: "*", displayOrder: 3 },
    { code: "green_tax", label: "Green tax", kind: "fixed", value: 999, enabled: false, displayOrder: 4 },
  ],
});
assert.equal(extras.lines.find((line) => line.code === "fov")?.amount, 80);
assert.equal(extras.lines.find((line) => line.code === "oda")?.marker, "*");
assert.equal(extras.lines.find((line) => line.code === "green_tax"), undefined);
assert.equal(extras.total, 594);

const capped = calculatePssRate({
  ...base,
  account: "04",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
  chargeRules: [
    { code: "fuel", label: "Fuel surcharge", kind: "percent", basis: "freight", value: 10, maximum: 25, displayOrder: 1 },
  ],
});
assert.equal(capped.lines.find((line) => line.code === "fuel")?.amount, 25);

const gst = calculatePssRate({
  ...base,
  account: "04",
  originCity: "Delhi",
  originState: "Delhi",
  destinationCity: "Bengaluru",
  destinationState: "Karnataka",
  gstPercent: 18,
});
assert.equal(gst.subtotal, 364);
assert.equal(gst.gst, 65.52);
assert.equal(gst.total, 429.52);

console.log("Delhivery B2B pricing engine acceptance scenarios passed.");
