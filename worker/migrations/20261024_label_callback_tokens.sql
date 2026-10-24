CREATE TABLE IF NOT EXISTS delhivery_label_callback_tokens (
  token TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  label_size TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delhivery_label_callback_tokens_expiry
  ON delhivery_label_callback_tokens (expires_at);
