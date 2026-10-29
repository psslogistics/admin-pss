-- Add explicit classification for standalone pickup requests.
-- This is forward-only and preserves every existing row.
ALTER TABLE pickup_requests ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_test_created
  ON pickup_requests(client_id, is_test, created_at DESC);
