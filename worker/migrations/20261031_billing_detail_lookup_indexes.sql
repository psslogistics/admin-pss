-- Keep billing detail lookups bounded as invoice history grows.
CREATE INDEX IF NOT EXISTS idx_pricing_overrides_shipment_time
  ON pricing_overrides(shipment_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_billing_amendments_shipment_time
  ON billing_amendments(shipment_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_weight_reconciliations_shipment_client
  ON weight_reconciliations(shipment_id, client_id);
