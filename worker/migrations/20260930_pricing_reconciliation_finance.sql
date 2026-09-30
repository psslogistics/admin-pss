CREATE TABLE IF NOT EXISTS pricing_provider_recoveries (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reconciliation_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'delhivery',
  recovered_amount REAL NOT NULL DEFAULT 0,
  client_credit_amount REAL NOT NULL DEFAULT 0,
  retained_amount REAL NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pricing_provider_recovery_client ON pricing_provider_recoveries(client_id, created_at DESC);
