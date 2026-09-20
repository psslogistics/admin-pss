ALTER TABLE pickup_requests ADD COLUMN assigned_to_user_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN failure_reason TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_pickup_requests_assignee_status
  ON pickup_requests(assigned_to_user_id, status, requested_date);
