import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");

const checks = [
  ["billing has a single invoice-number helper", source.includes("function shipmentInvoiceNumber")],
  ["LR is the first invoice reference", source.includes("shipment?.lr_number || shipment?.master_awb || shipment?.tracking_number")],
  ["UUIDs are not used as invoice-number fallbacks", !source.includes("INV-${shipmentId.slice(0, 8).toUpperCase()}")],
  ["manual billing does not derive invoice numbers from record UUIDs", !source.includes("INV-${recordId.slice(0, 8).toUpperCase()}")],
  ["manual billing preserves pending identity when no shipment reference exists", source.includes('"INV-PENDING-REFERENCE"')],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Billing contract checks failed: ${failed.join(", ")}`);
console.log(`Worker billing contract checks passed (${checks.length} checks).`);
