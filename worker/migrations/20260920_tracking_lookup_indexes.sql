-- Keep public tracking and provider webhook lookups index-backed as shipment volume grows.
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_number
  ON shipments(tracking_number);

CREATE INDEX IF NOT EXISTS idx_shipments_provider_reference_lookup
  ON shipments(provider_reference);
