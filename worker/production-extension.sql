-- Additive production extension for the existing D1 schema.
ALTER TABLE shipments ADD COLUMN provider TEXT;
ALTER TABLE shipments ADD COLUMN provider_reference TEXT;
ALTER TABLE shipments ADD COLUMN origin TEXT;
ALTER TABLE shipments ADD COLUMN destination TEXT;
ALTER TABLE shipments ADD COLUMN consignee TEXT;
ALTER TABLE shipments ADD COLUMN edd TEXT;
ALTER TABLE shipments ADD COLUMN delivered_at TEXT;
ALTER TABLE pickup_requests ADD COLUMN assigned_to_user_id TEXT;
ALTER TABLE pickup_requests ADD COLUMN failure_reason TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider TEXT;
ALTER TABLE pickup_requests ADD COLUMN provider_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_shipments_provider_reference ON shipments(provider, provider_reference);
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
CREATE INDEX IF NOT EXISTS idx_tracking_events_shipment_time ON tracking_events(shipment_id, event_time);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_client_date ON pickup_requests(client_id, requested_date);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_assignee_status ON pickup_requests(assigned_to_user_id, status, requested_date);
CREATE INDEX IF NOT EXISTS idx_support_tickets_client_status ON support_tickets(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(recipient_user_id, is_read, created_at);

CREATE TABLE IF NOT EXISTS ndr_cases (
  id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, client_id TEXT NOT NULL,
  reason TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1, deadline TEXT,
  status TEXT NOT NULL DEFAULT 'new', notes TEXT, assigned_to_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS exception_cases (
  id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, client_id TEXT NOT NULL,
  category TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', title TEXT NOT NULL,
  details TEXT, status TEXT NOT NULL DEFAULT 'new', assigned_to_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS return_shipments (
  id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, client_id TEXT NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', provider_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, author_user_id TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL, address TEXT NOT NULL,
  city TEXT, pincode TEXT, contact TEXT, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS client_addresses (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, label TEXT NOT NULL, contact_name TEXT,
  address_kind TEXT NOT NULL DEFAULT 'consignor' CHECK (address_kind IN ('consignor', 'consignee')),
  phone TEXT, address TEXT NOT NULL, city TEXT, state TEXT, country TEXT NOT NULL DEFAULT 'India',
  pincode TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rate_quotes (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, provider TEXT, origin_pincode TEXT NOT NULL,
  destination_pincode TEXT NOT NULL, weight_kg REAL NOT NULL, pieces INTEGER NOT NULL DEFAULT 1,
  amount REAL, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'calculated',
  expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS billing_records (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, shipment_id TEXT, invoice_number TEXT,
  amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR', status TEXT NOT NULL DEFAULT 'pending',
  due_date TEXT, paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL,
  balance_after REAL, reference TEXT, status TEXT NOT NULL DEFAULT 'posted', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cod_remittances (
  id TEXT PRIMARY KEY, client_id TEXT NOT NULL, shipment_id TEXT, amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', expected_at TEXT, settled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS weight_reconciliations (
  id TEXT PRIMARY KEY, shipment_id TEXT NOT NULL, client_id TEXT NOT NULL, declared_weight_kg REAL NOT NULL,
  measured_weight_kg REAL, billable_weight_kg REAL, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ndr_client_status ON ndr_cases(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_exception_client_status ON exception_cases(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_returns_client_status ON return_shipments(client_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_time ON support_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_warehouses_client_status ON warehouses(client_id, status);
CREATE INDEX IF NOT EXISTS idx_addresses_client_status ON client_addresses(client_id, status);
CREATE INDEX IF NOT EXISTS idx_billing_client_status ON billing_records(client_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_client_time ON wallet_transactions(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cod_client_status ON cod_remittances(client_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_weight_client_status ON weight_reconciliations(client_id, status, updated_at);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  shipment_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to_user_id TEXT,
  due_at TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  manager_user_id TEXT,
  capacity_percent INTEGER NOT NULL DEFAULT 100 CHECK (capacity_percent BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS departments_status_idx ON departments(status);
CREATE INDEX IF NOT EXISTS departments_manager_user_id_idx ON departments(manager_user_id);
CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('delhivery', 'ekart')),
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'production',
  credential_secret_name TEXT NOT NULL,
  client_id TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, account_name)
);
CREATE INDEX IF NOT EXISTS provider_accounts_client_idx ON provider_accounts(client_id, provider, status);
CREATE INDEX IF NOT EXISTS provider_accounts_provider_idx ON provider_accounts(provider, status);
CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks(client_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status ON tasks(assigned_to_user_id, status, due_at);

CREATE TABLE IF NOT EXISTS request_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
);
