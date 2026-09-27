-- Cover the timestamp/client access patterns used by the authenticated
-- dashboard summary. These indexes keep the LIMIT queries from scanning and
-- sorting entire operational tables as the production dataset grows.
CREATE INDEX IF NOT EXISTS idx_shipments_created_at ON shipments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_client_created_at ON shipments(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pickups_requested_date ON pickup_requests(requested_date DESC);
CREATE INDEX IF NOT EXISTS idx_pickups_client_requested_date ON pickup_requests(client_id, requested_date DESC);

CREATE INDEX IF NOT EXISTS idx_billing_created_at ON billing_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_client_created_at ON billing_records(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_created_at ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_client_created_at ON wallet_transactions(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exceptions_updated_at ON exception_cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exceptions_client_updated_at ON exception_cases(client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ndr_updated_at ON ndr_cases(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ndr_client_updated_at ON ndr_cases(client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_client_created_at ON activity_events(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_returns_updated_at ON return_shipments(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_returns_client_updated_at ON return_shipments(client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_updated_at ON support_tickets(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_client_updated_at ON support_tickets(client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_client_created_at ON notifications(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created_at ON notifications(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_due_at ON tasks(due_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_client_due_at ON tasks(client_id, due_at ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_due_at ON tasks(assigned_to_user_id, due_at ASC);
