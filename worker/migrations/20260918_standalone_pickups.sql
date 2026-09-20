-- Allow Client standalone pickup requests while preserving existing rows.
-- The live table already contains contact_name/contact_phone and operational
-- columns; only shipment_id needs to become nullable.

CREATE TABLE pickup_requests_new (
  id TEXT PRIMARY KEY,
  shipment_id TEXT,
  client_id TEXT NOT NULL,
  requested_date TEXT NOT NULL,
  requested_time_slot TEXT,
  pickup_address TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  notes TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_to_user_id TEXT,
  failure_reason TEXT,
  provider TEXT,
  provider_reference TEXT,
  FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE
);

INSERT INTO pickup_requests_new (
  id, shipment_id, client_id, requested_date, requested_time_slot,
  pickup_address, contact_name, contact_phone, status, notes,
  created_by_user_id, created_at, updated_at, assigned_to_user_id,
  failure_reason, provider, provider_reference
)
SELECT id, shipment_id, client_id, requested_date, requested_time_slot,
  pickup_address, contact_name, contact_phone, status, notes,
  created_by_user_id, created_at, updated_at, assigned_to_user_id,
  failure_reason, provider, provider_reference
FROM pickup_requests;

DROP TABLE pickup_requests;
ALTER TABLE pickup_requests_new RENAME TO pickup_requests;

CREATE INDEX idx_pickup_requests_client_date
  ON pickup_requests(client_id, requested_date);
CREATE INDEX idx_pickup_requests_assignee_status
  ON pickup_requests(assigned_to_user_id, status, requested_date);
