-- Complete the canonical pickup_requests contract used by Client and Worker.
-- These fields are additive so existing pickup history remains readable.
ALTER TABLE pickup_requests ADD COLUMN provider_account_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN warehouse_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN contact_email TEXT;
ALTER TABLE pickup_requests ADD COLUMN city TEXT;
ALTER TABLE pickup_requests ADD COLUMN state TEXT;
ALTER TABLE pickup_requests ADD COLUMN pincode TEXT;
ALTER TABLE pickup_requests ADD COLUMN country TEXT NOT NULL DEFAULT 'India';
ALTER TABLE pickup_requests ADD COLUMN pieces INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pickup_requests ADD COLUMN total_weight_kg REAL;
ALTER TABLE pickup_requests ADD COLUMN provider_status TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_request_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_slot_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_awb_numbers_json TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_error_code TEXT;
ALTER TABLE pickup_requests ADD COLUMN idempotency_key TEXT;

CREATE INDEX IF NOT EXISTS idx_pickup_requests_provider_account
  ON pickup_requests(provider_account_id, requested_date);

CREATE TABLE IF NOT EXISTS pickup_request_attempts (
  id TEXT PRIMARY KEY,
  pickup_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT,
  request_id TEXT,
  idempotency_key TEXT,
  requested_date TEXT,
  requested_time_slot TEXT,
  status TEXT NOT NULL,
  provider_status TEXT,
  provider_reference TEXT,
  provider_error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pickup_id) REFERENCES pickup_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pickup_attempts_pickup_created
  ON pickup_request_attempts(pickup_id, created_at DESC);

-- Track provider registration separately from the local saved warehouse row.
ALTER TABLE warehouses ADD COLUMN provider TEXT;
ALTER TABLE warehouses ADD COLUMN provider_account_id TEXT;
ALTER TABLE warehouses ADD COLUMN provider_status TEXT;
ALTER TABLE warehouses ADD COLUMN provider_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_warehouses_provider_identity
  ON warehouses(client_id, provider, provider_account_id, provider_status);
