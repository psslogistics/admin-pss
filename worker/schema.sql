CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  created_by_user_id TEXT,
  provider TEXT,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'booked',
  description TEXT NOT NULL DEFAULT '',
  origin TEXT,
  destination TEXT,
  origin_address_json TEXT,
  destination_address_json TEXT,
  consignee TEXT,
  total_weight_kg REAL NOT NULL DEFAULT 0,
  declared_value REAL NOT NULL DEFAULT 0,
  pieces INTEGER NOT NULL DEFAULT 1,
  edd TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shipment_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL,
  location TEXT,
  note TEXT,
  provider_event_id TEXT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider_event_id)
);

-- Worker-compatible tracking event projection. Keep shipment_events for
-- legacy consumers while the API reads and writes this normalized shape.
CREATE TABLE IF NOT EXISTS tracking_events (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  status TEXT NOT NULL,
  location TEXT,
  description TEXT,
  created_by_user_id TEXT,
  event_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_time
  ON tracking_events(shipment_id, event_time);

CREATE TABLE IF NOT EXISTS pickups (
  id TEXT PRIMARY KEY,
  shipment_id TEXT,
  client_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  window TEXT,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  provider TEXT,
  provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Canonical API table used by the Worker and all panels. shipment_id is
-- nullable because the Client supports standalone pickup requests.
CREATE TABLE IF NOT EXISTS pickup_requests (
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

CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_date
  ON pickup_requests(client_id, requested_date);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_assignee_status
  ON pickup_requests(assigned_to_user_id, status, requested_date);

CREATE TABLE IF NOT EXISTS shipment_documents (
  id TEXT PRIMARY KEY,
  shipment_id TEXT,
  client_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  environment TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  last_used_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS api_key_scopes (
  api_key_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  PRIMARY KEY(api_key_id, scope)
);

CREATE TABLE IF NOT EXISTS api_key_events (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_key_usage (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  bytes_out INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_key TEXT NOT NULL,
  client_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(idempotency_key, client_id, endpoint)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  client_id TEXT,
  shipment_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature_valid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, event_id)
);

CREATE TABLE IF NOT EXISTS integration_requests (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  client_id TEXT,
  operation TEXT NOT NULL,
  idempotency_key TEXT,
  provider_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'retrying')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipments_client_created ON shipments(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_shipments_provider_reference ON shipments(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment_time ON shipment_events(shipment_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_shipment_events_client_time ON shipment_events(client_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pickups_client_date ON pickups(client_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_shipment_documents_client ON shipment_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_client_status ON api_keys(client_id, status);
CREATE INDEX IF NOT EXISTS idx_api_key_events_key_time ON api_key_events(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_time ON api_key_usage(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_expiry ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_integration_provider_status ON integration_requests(provider, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_webhook_provider_status ON webhook_events(provider, status, created_at);

CREATE TABLE IF NOT EXISTS ndr_cases (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  assigned_to_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exception_cases (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS return_shipments (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  shipment_id TEXT,
  created_by_user_id TEXT NOT NULL,
  assigned_to_user_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  sla_due_at TEXT,
  escalation_state TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL,
  client_id TEXT,
  shipment_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT,
  pincode TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS client_addresses (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  label TEXT NOT NULL,
  address_kind TEXT NOT NULL DEFAULT 'consignor' CHECK (address_kind IN ('consignor', 'consignee')),
  contact_name TEXT,
  phone TEXT,
  address TEXT NOT NULL,
  city TEXT,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'India',
  pincode TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employee_preferences (
  user_id TEXT PRIMARY KEY,
  email_notifications INTEGER NOT NULL DEFAULT 1,
  task_reminders INTEGER NOT NULL DEFAULT 1,
  compact_layout INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_quotes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  provider TEXT,
  origin_pincode TEXT NOT NULL,
  destination_pincode TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  pieces INTEGER NOT NULL DEFAULT 1,
  amount REAL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'calculated',
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_records (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  shipment_id TEXT,
  invoice_number TEXT,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  balance_after REAL,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cod_remittances (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  shipment_id TEXT,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  expected_at TEXT,
  settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS weight_reconciliations (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  declared_weight_kg REAL NOT NULL,
  measured_weight_kg REAL,
  billable_weight_kg REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  meta TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ndr_client_status ON ndr_cases(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_exception_client_status ON exception_cases(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_returns_client_status ON return_shipments(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tickets_client_status ON support_tickets(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_ticket_time ON support_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(recipient_user_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_warehouses_client_status ON warehouses(client_id, status);
CREATE INDEX IF NOT EXISTS idx_addresses_client_status ON client_addresses(client_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_client_status ON billing_records(client_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_client_time ON wallet_transactions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cod_client_status ON cod_remittances(client_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_weight_client_status ON weight_reconciliations(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_master_records_kind_updated ON master_records(kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_records_client_kind ON master_records(client_id, kind, updated_at DESC);
