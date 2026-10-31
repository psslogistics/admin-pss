-- Support the organization-wide tracking count aggregate and the
-- client-visible shipment register while preserving created-date ordering.
CREATE INDEX IF NOT EXISTS idx_shipments_test_status_edd_created
  ON shipments(is_test, status, edd, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_client_test_status_edd_created
  ON shipments(client_id, is_test, status, edd, created_at DESC);
