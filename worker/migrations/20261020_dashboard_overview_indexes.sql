-- Support the scoped, status-filtered reads used by the lightweight client dashboard overview.
CREATE INDEX IF NOT EXISTS idx_shipments_client_edd_status ON shipments(client_id, edd, status);
CREATE INDEX IF NOT EXISTS idx_pickups_client_status_date ON pickup_requests(client_id, status, requested_date);
CREATE INDEX IF NOT EXISTS idx_billing_client_status_created_at ON billing_records(client_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_client_status_updated_at ON exception_cases(client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ndr_client_status_updated_at ON ndr_cases(client_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_client_read_created_at ON notifications(client_id, is_read, created_at DESC);
