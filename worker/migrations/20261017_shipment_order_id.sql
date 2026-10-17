ALTER TABLE shipments ADD COLUMN order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_shipments_order_id
  ON shipments(order_id);
