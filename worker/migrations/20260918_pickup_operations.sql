-- These columns are part of the canonical worker/schema.sql baseline.

CREATE INDEX IF NOT EXISTS idx_pickup_requests_assignee_status
  ON pickup_requests(assigned_to_user_id, status, requested_date);
