import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
const indexes = await readFile(new URL("../migrations/20261031_billing_detail_lookup_indexes.sql", import.meta.url), "utf8");

const checks = [
  ["billing has a single invoice-number helper", source.includes("function shipmentInvoiceNumber")],
  ["LR is the first invoice reference", source.includes("shipment?.lr_number || shipment?.master_awb || shipment?.tracking_number")],
  ["late Delhivery LR reconciliation does not preserve the synchronous timeout as shipment failure", source.includes("provider_sync_status = 'confirmed'") && source.includes("provider_last_error = NULL")],
  ["every provider-confirmed LR attempts shipment billing completion", (() => {
    const start = source.indexOf('if (response.ok && provider === "delhivery" && useDelhiveryB2b && operation === "shipment_status"');
    const end = source.indexOf('if (response.ok && provider === "delhivery" && operation === "shipment_status"', start + 1);
    const block = source.slice(start, end > start ? end : undefined);
    const call = block.indexOf("await completeConfirmedShipmentBilling(env, clientId, payload.shipment_id, \"shipment_status\")");
    return start >= 0 && call >= 0 && !block.slice(0, call).includes("if (!lateAfterSynchronousFailure)");
  })()],
  ["late LR references from tracking and webhook paths enter idempotent billing reconciliation", source.includes('completeConfirmedShipmentBilling(env, clientId, payload.shipment_id, "tracking")') && source.includes('completeConfirmedShipmentBilling(env, shipment.client_id, shipment.id, "out_of_order_webhook")') && source.includes('completeConfirmedShipmentBilling(env, shipment.client_id, shipment.id, "status_webhook")')],
  ["billing is gated on a confirmed provider reference", source.includes('if (!invoiceReference || shipment?.provider_sync_status !== "confirmed")')],
  ["confirmed billing deferrals are explicitly marked for bounded recovery", source.includes("Shipment billing deferred:%") && source.includes("LIMIT 20") && source.includes("await reconcileDeferredShipmentBilling(env, controller.cron)")],
  ["queued accepted bookings do not bill while the provider reference is pending", source.includes("const hasConfirmedReference = Boolean(providerResult.lr_number || providerResult.master_awb || providerResult.providerReference) && providerResult.providerPending !== true")],
  ["wallet funds are rechecked atomically with shipment billing inserts", source.includes("FROM wallet_transactions WHERE client_id = ? AND status IN ('posted', 'approved')) >= ?") && source.includes("WHERE EXISTS (SELECT 1 FROM billing_records WHERE id = ? AND client_id = ? AND status = 'paid')")],
  ["billing completion stays idempotent by shipment and client", source.includes("SELECT id FROM billing_records WHERE shipment_id = ? AND client_id = ? LIMIT 1") && source.includes('`wallet-${shipmentId}`')],
  ["UUIDs are not used as invoice-number fallbacks", !source.includes("INV-${shipmentId.slice(0, 8).toUpperCase()}")],
  ["manual billing does not derive invoice numbers from record UUIDs", !source.includes("INV-${recordId.slice(0, 8).toUpperCase()}")],
  ["manual billing preserves pending identity when no shipment reference exists", source.includes('"INV-PENDING-REFERENCE"')],
  ["billing API cycles are inclusive days", source.includes("`-${days - 1} days`")],
  ["billing detail collections are fetched in the main query", source.includes("AS adjustments_json") && source.includes("AS amendments_json") && source.includes("AS line_items_json")],
  ["billing response avoids per-record detail queries", !source.includes("Promise.all(pageRows.map(async")],
  ["billing response keeps detail collections as arrays", source.includes("line_items: Array.isArray(lineItems) ? lineItems : []") && source.includes("adjustments: Array.isArray(adjustments) ? adjustments : []")],
  ["provider weight update writes effective billable weight to reconciliation", source.includes("SET measured_weight_kg = ?, courier_billed_weight_kg = ?, billable_weight_kg = ?")],
  ["provider weight update persists effective weight without overwriting manual values", source.includes("UPDATE shipments SET weight_override_kg = ?, weight_source = 'reconciled'") && source.includes("COALESCE(weight_source, 'booking') <> 'manual'")],
  ["manual weight override remains authoritative", source.includes("hasManualWeight") && source.includes("weight_override_kg ?? shipment.total_weight_kg")],
  ["provider reprice uses the effective minimum and declared weight", source.includes("total_weight_kg: effectiveWeightKg")],
  ["billing detail queries have shipment-key indexes", indexes.includes("idx_pricing_overrides_shipment_time") && indexes.includes("idx_billing_amendments_shipment_time")],
  ["weight reconciliation writes have a shipment-key index", indexes.includes("idx_weight_reconciliations_shipment_client")],
];

const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Billing contract checks failed: ${failed.join(", ")}`);
console.log(`Worker billing contract checks passed (${checks.length} checks).`);
