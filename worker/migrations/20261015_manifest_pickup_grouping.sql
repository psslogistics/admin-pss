-- Group manifested shipments by the consignor pickup address and provider
-- pickup window without breaking the legacy primary shipment_id column.
CREATE TABLE IF NOT EXISTS pickup_request_shipments (
  pickup_id TEXT NOT NULL,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pickup_id, shipment_id),
  FOREIGN KEY (pickup_id) REFERENCES pickup_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pickup_request_shipments_shipment
  ON pickup_request_shipments(shipment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pickup_request_shipments_pickup
  ON pickup_request_shipments(pickup_id, created_at DESC);
