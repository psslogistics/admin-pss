-- Keep test data explicitly classifiable without guessing from names or IDs.
-- Existing records remain client-visible until an authorized operator marks
-- them as test data; this migration is intentionally non-destructive.
ALTER TABLE shipments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_addresses ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pickup_requests ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shipments_client_test_created
  ON shipments(client_id, is_test, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouses_client_test_updated
  ON warehouses(client_id, is_test, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_addresses_client_test_updated
  ON client_addresses(client_id, is_test, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_test_created
  ON pickup_requests(client_id, is_test, created_at DESC);
