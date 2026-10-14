ALTER TABLE warehouses ADD COLUMN provider_name TEXT;
ALTER TABLE warehouses ADD COLUMN provider_error TEXT;
ALTER TABLE warehouses ADD COLUMN provider_activated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_warehouses_exact_provider_name
  ON warehouses(client_id, provider, provider_account_id, name);
