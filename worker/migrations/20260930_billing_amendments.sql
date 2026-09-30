CREATE TABLE IF NOT EXISTS billing_amendments (
  id TEXT PRIMARY KEY,
  billing_id TEXT NOT NULL REFERENCES billing_records(id) ON DELETE CASCADE,
  shipment_id TEXT,
  client_id TEXT NOT NULL,
  amendment_type TEXT NOT NULL CHECK (amendment_type IN ('courier_weight_debit', 'client_weight_credit', 'component_override')),
  previous_amount REAL NOT NULL,
  new_amount REAL NOT NULL,
  reason TEXT NOT NULL,
  weight_received_at TEXT,
  ticket_deadline_at TEXT,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_billing_amendments_client_time ON billing_amendments(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_amendments_billing_time ON billing_amendments(billing_id, created_at ASC);
