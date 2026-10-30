-- Keep courier-reported facts immutable while allowing an attributed internal
-- correction proposal to be recorded for review.
CREATE TABLE IF NOT EXISTS shipment_provider_corrections (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN (
    'lr_number', 'master_awb', 'provider_reference', 'tracking_number',
    'status', 'weight', 'eta', 'delivered_at'
  )),
  provider_value TEXT NOT NULL DEFAULT '',
  correction_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shipment_provider_corrections_shipment
  ON shipment_provider_corrections(shipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipment_provider_corrections_client
  ON shipment_provider_corrections(client_id, created_at DESC);
