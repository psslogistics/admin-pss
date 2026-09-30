CREATE TABLE IF NOT EXISTS pricing_provider_costs (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  provider_amount REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  provider_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pricing_provider_cost_client ON pricing_provider_costs(client_id, created_at DESC);
