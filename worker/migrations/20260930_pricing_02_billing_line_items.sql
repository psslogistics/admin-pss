CREATE TABLE IF NOT EXISTS billing_line_items (
  id TEXT PRIMARY KEY,
  billing_id TEXT NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
  shipment_id TEXT,
  client_id TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  marker TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_line_items_billing ON billing_line_items(billing_id, display_order, code);
CREATE INDEX IF NOT EXISTS idx_billing_line_items_client ON billing_line_items(client_id, created_at DESC);
