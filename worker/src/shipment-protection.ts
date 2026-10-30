const PROVIDER_MANAGED_SHIPMENT_FIELDS = [
  "provider",
  "provider_reference",
  "tracking_number",
  "lr_number",
  "status",
  "total_weight_kg",
  "edd",
  "delivered_at",
] as const;

export function providerManagedShipmentFields(payload: Record<string, unknown>): string[] {
  return PROVIDER_MANAGED_SHIPMENT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(payload, field));
}
